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

module.exports = function (RED) {
    "use strict";

    RED.nodes.registerType("ack-req", function (n) {
        RED.nodes.createNode(this, n);
        var node = this;
        node.ttl = n.ttl;
        node.ttlType = n.ttlType;
        node.units = n.units;
        node.unitsType = n.unitsType;
        node.timers = {};
        node.links = n.links["ack"];

        var event = "node:" + n.id;
        var handler = function (msg) {
            if (node.timers[msg.id])
                timers.clearTimeout(node.timers[msg.id]);
        };
        node.links.forEach((link) => {
            RED.events.on("node:" + link, handler);
        });

        this.on("input", function (msg) {
            var ttl = RED.util.evaluateNodeProperty(node.ttl, node.ttlType, node, msg);
            var units = RED.util.evaluateNodeProperty(node.units, node.unitsType, node, msg);

            if (isNaN(ttl))
                node.error("TTL must be a number.", msg);

            switch (String(units).toLowerCase()) {
                case "milliseconds":
                    break;
                case "minutes":
                    ttl = ttl * 1000 * 60;
                    break;
                case "hours":
                    ttl = ttl * 1000 * 60 * 60;
                    break;
                default:
                    ttl = ttl * 1000;
            }

            node.timers[msg.id] = timers.setTimeout(() => {
                msg._event = event;
                RED.events.emit(event, msg);
            }, Number(ttl));

            this.send(msg);
        });

        this.on("close", function () {
            node.links.forEach((link) => {
                RED.events.removeListener("node:" + link, handler);
            });
        });
    });

    RED.nodes.registerType("ack-fail", function (n) {
        RED.nodes.createNode(this, n);
        var node = this;
        node.links = n.links["ack-req"];

        var handler = function (msg) {
            node.receive(msg);
        }

        node.links.forEach((link) => {
            RED.events.on("node:" + link, handler);
        });

        this.on("input", function (msg) {
            this.send(msg);
        });

        this.on("close", function () {
            node.links.forEach((link) => {
                RED.events.removeListener("node:" + link, handler);
            });
        });
    });

    RED.nodes.registerType("ack", function (n) {
        RED.nodes.createNode(this, n);
        var event = "node:" + n.id;

        this.on("input", function (msg) {
            msg._event = event;
            RED.events.emit(event, msg);
        });
    });
}
