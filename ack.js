/**
 * Copyright 2020 Tyler Eastman.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

module.exports = function (RED) {
    "use strict";

    const timers = require('timers');
    const fs = require('fs-extra');
    const path = require('path');

    var FOLDER_NAME = "ack_msg_cache";
    if (RED.settings.fileWorkingDirectory) {
        FOLDER_NAME = path.join(RED.settings.fileWorkingDirectory, FOLDER_NAME);
    }

    // Clean up any orphaned folders and files.  Happens when ack-start nodes are deleted.
    RED.events.on("flows:started", function (event) {
        // Get list of ack-start nodes.
        const existingNodes = [];
        RED.nodes.eachNode(function (node) {
            if (node.type === "ack-start") {
                existingNodes.push(node.id.replace(".", ""));
            }
        });

        // Get list of ack_msg_cache node folders
        var directories = fs.readdirSync(FOLDER_NAME, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        // Delete any folders that don't have a corresponding node.
        directories.forEach(directoryName => {
            if (existingNodes.indexOf(directoryName) < 0) {
                fs.rm(path.join(FOLDER_NAME, directoryName), { recursive: true });
            }
        });
    });

    RED.nodes.registerType("ack-start", function (n) {
        RED.nodes.createNode(this, n);

        var node = this;
        node.ttl = n.ttl;
        node.ttlType = n.ttlType;
        node.units = n.units;
        node.unitsType = n.unitsType;
        node.key = n.key;
        node.keyType = n.keyType;
        node.timers = {};
        node.links = n.links;
        node.persist = n.persist;

        const NODE_FOLDER_NAME = path.join(FOLDER_NAME, n.id.replace(".", ""));

        // If the node is set to persistent, ensure that the persistence folder exists.
        // Otherwise remove it if it does exist.
        if (node.persist) {
            fs.ensureDirSync(NODE_FOLDER_NAME);
        }
        else if (fs.existsSync(NODE_FOLDER_NAME)) {
            fs.rm(NODE_FOLDER_NAME, { recursive: true });
        }

        // Stores a msg to the filesystem.
        function addPersistentMsg(msg, tod) {

            // Exit if this isn't a persistent node.
            if (!node.persist) {
                return;
            }

            msg._ack_cached_tod = tod;

            // Get the property value to use as the ID.
            var key = RED.util.evaluateNodeProperty(node.key, node.keyType, node, msg);
            var id = (msg.hasOwnProperty(key)) ? msg[key] : msg._msgid;
            if(id.indexOf("/") > -1 || id.indexOf("\\") > -1) {
                node.error('The value of the defined ID Property may not contain a "/" or "\\" character.');
                return;
            }

            fs.writeFile(path.join(NODE_FOLDER_NAME, id), JSON.stringify(msg), err => {
                if(err){
                    node.error(`Failed to write persistent msg to file: ${path.join(NODE_FOLDER_NAME, id)}`);
                }
            });
        }

        // Removes a msg from the filesystem.
        function removePersistentMsg(id) {
            if (!node.persist) {
                return;
            }

            fs.rm(path.join(NODE_FOLDER_NAME, id), err => {
                // Do nothing, the file may not exist.
                // Could have been removed by another ack-clear node.
            });
        }

        // Callback for when an ack-clear is called.
        function handler(msg) {

            // Get the property value to use as the ID.
            var key = RED.util.evaluateNodeProperty(node.key, node.keyType, node, msg);
            var id = (msg.hasOwnProperty(key)) ? msg[key] : msg._msgid;
            if(id.indexOf("/") > -1 || id.indexOf("\\") > -1) {
                node.error('The value of the defined ID Property may not contain a "/" or "\\" character.');
                return;
            }

            removePersistentMsg(id);

            // Clear the timer.
            if (node.timers[id]) {
                timers.clearTimeout(node.timers[id].timer);
                node.timers[id].done();
                delete node.timers[id];
            }
        };

        // Link the communication for ack-clear to the ack-start.
        node.links.forEach((link) => {
            RED.events.on("node:" + link, handler);
        });

        node.on("input", function (msg, send, done) {
            // If this node is installed in Node-RED 0.x provide fallbacks.
            send = send || function () { node.send.apply(node, arguments) }
            done = done || function (err) { if (err) { node.error(err, msg); } }

            var ttl = RED.util.evaluateNodeProperty(node.ttl, node.ttlType, node, msg);
            var units = RED.util.evaluateNodeProperty(node.units, node.unitsType, node, msg);
            
            // Get the property value to use as the ID.
            var key = RED.util.evaluateNodeProperty(node.key, node.keyType, node, msg);
            var id = (msg.hasOwnProperty(key)) ? msg[key] : msg._msgid;
            if(id.indexOf("/") > -1 || id.indexOf("\\") > -1) {
                node.error('The value of the defined ID Property may not contain a "/" or "\\" character.');
                return done();
            }

            // ttl is required.
            if (isNaN(ttl)) {
                return done("TTL must be a number.");
            }

            // convert ttl to milliseconds.
            switch (String(units).toLowerCase()) {
                case "milliseconds":
                    break;
                case "minutes":
                    ttl = ttl * 1000 * 60;
                    break;
                case "hours":
                    ttl = ttl * 1000 * 60 * 60;
                    break;
                default:  // seconds
                    ttl = ttl * 1000;
            }

            // If the msg already has a timer it's a repeat.
            // send it along and go no further.
            if(node.timers[id]){
                send([msg, null, null]);
                return done();
            }

            // If the msg came from the persistent store, send it on the third output.
            if (msg._ack_cached_tod) {
                send([null, null, msg]);
                ttl = msg._ack_cached_tod - Date.now();
            }
            else {
                addPersistentMsg(msg, Date.now() + ttl);
                send([msg, null, null]);
            }

            // If there is a ttl, schedule a timeout.
            if (ttl > 0) {
                const timeout_msg = Object.assign({}, msg);
                node.timers[id] = {
                    timer: timers.setTimeout((send, done, ) => {
                        removePersistentMsg(id);
                        send([null, timeout_msg, null]);
                        done();
                        delete node.timers[id];
                    }, Number(ttl), send, done),
                    done: done
                }
            }

            // If there is no ttl left, send it on the timeout output and remove from persistent store.
            else {
                removePersistentMsg(id);
                send([null, msg, null]);
                done();
            }
        });

        // On close remove all timers and link listeners.
        node.on("close", function () {
            Object.keys(node.timers).forEach((key) => {
                timers.clearTimeout(node.timers[key].timer);
            });

            node.links.forEach((link) => {
                RED.events.removeListener("node:" + link, handler);
            });
        });

        // Read in all and send all persisted messages.
        if (node.persist) {
            fs.readdirSync(NODE_FOLDER_NAME, { withFileTypes: true }).forEach(dirent => {
                var raw = fs.readFileSync(path.join(NODE_FOLDER_NAME, dirent.name));

                // This timeout is set to make sure that all other nodes have been initialized.
                timers.setTimeout(() => {
                    node.receive(JSON.parse(raw));
                }, 100);
            });
        }
    });

    RED.nodes.registerType("ack-clear", function (n) {
        RED.nodes.createNode(this, n);
        const event = "node:" + n.id;

        this.on("input", function (msg) {
            msg._event = event;
            RED.events.emit(event, msg);
        });
    });
}
