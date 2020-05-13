node-red-contrib-ack
========================
A Node-RED node for verifying that a message is processed.

Install
-------
Run the following command in the root directory of your Node-RED install

    npm install node-red-contrib-ack

Usage
-------
Any message that enters the `ack start` node will be stored internally in a queue with a specified timeout (Time to live), and is then passed on through the `msg` line.  If the message does not reach an `ack clear` node before the timeout passes, the `ack start` node will emit the message on it's `timeout` line, and the message will be removed from the queue.

If the persistent option is set and the server is reboot or redeployed while the `ack start` node has messages stored, they will be emitted on the `boot` line at startup. If those messages have also timed out they will be emitted on the `timeout` line as well.

Acknowledgements
----------------

The node-red-contrib-ack uses the following open source

- [material icons](https://google.github.io/material-design-icons/)

Node link concept sourced from

- [node-red link node](https://github.com/node-red/node-red/blob/master/packages/node_modules/%40node-red/nodes/core/common/60-link.html)
