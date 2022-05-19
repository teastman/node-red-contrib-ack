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
const timers = require('timers');
const fs = require('fs');
const { join } = require('path')
const FOLDER_NAME = "ack_msg_cache";

module.exports = function (RED) {
    "use strict";

    // Clean up any orphaned folders and files.  This can happen if the flow file is modified while the server is down.
    RED.events.on("flows:started", function (event) {
        // Get a list of ack-start nodes.
        const existingNodes = [];
        RED.nodes.eachNode(function (node) {
            if (node.type === "ack-start")
                existingNodes.push(node.id.replace(".", ""));
        });

        if (!fs.existsSync(FOLDER_NAME)){
            fs.mkdirSync(FOLDER_NAME, { recursive: true });
        }

        // Get list of ack_msg_cache folders
        var directories = fs.readdirSync(FOLDER_NAME, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        // Delete any folders that don't have a corresponding node.
        directories.forEach(directoryName => {
            if (existingNodes.indexOf(directoryName) < 0) {
                fs.rmdir(join(FOLDER_NAME, directoryName), { recursive: true }, err => {
                    if (err)
                        throw err;
                });
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
        node.timers = {};
        node.links = n.links;
        node.persist = n.persist;

        const NODE_FOLDER_NAME = join(FOLDER_NAME, n.id.replace(".", ""));

        if (node.persist) {
            // Setup ack_msg_cache folder for this node.
            if (!fs.existsSync(FOLDER_NAME))
                fs.mkdirSync(FOLDER_NAME);

            if (!fs.existsSync(NODE_FOLDER_NAME))
                fs.mkdirSync(NODE_FOLDER_NAME);

            // Read in all cached messages.
            fs.readdirSync(NODE_FOLDER_NAME, { withFileTypes: true }).forEach(dirent => {
                var raw = fs.readFileSync(join(NODE_FOLDER_NAME, dirent.name));
                node.receive(JSON.parse(raw));
            });
        }
        else {
            // If this is a non-persistent node delete the folder if it exists.
            if (fs.existsSync(NODE_FOLDER_NAME)) {
                fs.rmdir(NODE_FOLDER_NAME, { recursive: true }, err => {
                    if (err)
                        throw err;
                });
            }
        }

        function addCacheMsg(msg, tod) {
            if (!node.persist)
                return;

            msg._ack_cached_tod = tod;
            fs.writeFile(join(NODE_FOLDER_NAME, msg._msgid.replace(".", "")), JSON.stringify(msg), err => {
                if (err) throw err;
            });
        }

        function removeCacheMsg(id) {
            if (!node.persist)
                return;

            fs.unlink(join(NODE_FOLDER_NAME, id), err => {});
        }

        function handler(msg) {
            var id = msg._msgid.replace(".", "");
            removeCacheMsg(id);
            if (node.timers[id]) {
                timers.clearTimeout(node.timers[id].timer);
                node.timers[id].done();
            }
        };

        node.links.forEach((link) => {
            RED.events.on("node:" + link, handler);
        });

        this.on("input", function (msg, send, done) {
            // If this node is installed in Node-RED 0.x provide fallbacks.
            send = send || function () { node.send.apply(node, arguments) }
            done = done || function (err) { if (err) { node.error(err, msg); } }

            var id = msg._msgid.replace(".", "");
            var ttl = RED.util.evaluateNodeProperty(node.ttl, node.ttlType, node, msg);
            var units = RED.util.evaluateNodeProperty(node.units, node.unitsType, node, msg);

            if (isNaN(ttl))
                done("TTL must be a number.");

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
            if(node.timers[id]){
                this.send([msg, null, null]);
                return done();
            }

            // If the msg was sourced from the boot cache.
            if (msg._ack_cached_tod) {
                this.send([null, null, msg]);
                ttl = msg._ack_cached_tod - Date.now();
            }
            else {
                addCacheMsg(msg, Date.now() + ttl);
                this.send([msg, null, null]);
            }

            if (ttl > 0) {
                node.timers[id] = {
                    timer: timers.setTimeout((send, done) => {
                        removeCacheMsg(id);
                        send([null, msg, null]);
                        done();
                    }, Number(ttl), send, done),
                    done: done
                }
            }
            else {
                removeCacheMsg(id);
                send([null, msg, null]);
                done();
            }
        });

        this.on("close", function () {
            Object.keys(node.timers).forEach((key) => {
                timers.clearTimeout(node.timers[key].timer);
            });

            node.links.forEach((link) => {
                RED.events.removeListener("node:" + link, handler);
            });
        });
    });

    RED.nodes.registerType("ack-clear", function (n) {
        RED.nodes.createNode(this, n);
        var event = "node:" + n.id;

        this.on("input", function (msg) {
            msg._event = event;
            RED.events.emit(event, msg);
        });
    });
}
