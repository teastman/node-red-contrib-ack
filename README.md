node-red-contrib-ack
========================
A Node-RED node for verifying that a message is processed.

Install
-------
Run the following command in the root directory of your Node-RED install

    npm install node-red-contrib-ack

Usage
-------

Any message that enters the `ack req` node will be stored internally with a specified timeout, and passed on through the `msg` line.  If the message does not reach an `ack` node before the timeout passes, the `ack req` node will emit the message on it's `timeout` line.

If the server is reboot while the `ack req` node has messages stored, they will be emitted on the `boot` line at startup.  If those messages have also timed out they will be emitted on the `timeout` line as well.

Acknowledgements
----------------

The node-red-contrib-ack uses the following open source

- [material icons](https://google.github.io/material-design-icons/)
