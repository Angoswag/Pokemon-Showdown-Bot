﻿/**
 * This is the main file of Pokémon Showdown Bot
 *
 * Some parts of this code are taken from the Pokémon Showdown server code, so
 * credits also go to Guangcong Luo and other Pokémon Showdown contributors.
 * https://github.com/Zarel/Pokemon-Showdown
 *
 * @license MIT license
 */

const MESSAGE_THROTTLE = 650;

global.info = function (text) {
	if (Config.debuglevel > 3) return;
	if (!colors) global.colors = require('colors');
	console.log('info'.cyan + '  ' + text);
};

global.debug = function (text) {
	if (Config.debuglevel > 2) return;
	if (!colors) global.colors = require('colors');
	console.log('debug'.blue + ' ' + text);
};

global.recv = function (text) {
	if (Config.debuglevel > 0) return;
	if (!colors) global.colors = require('colors');
	console.log('recv'.grey + '  ' + text);
};

global.cmdr = function (text) { // receiving commands
	if (Config.debuglevel !== 1) return;
	if (!colors) global.colors = require('colors');
	console.log('cmdr'.grey + '  ' + text);
};

global.dsend = function (text) {
	if (Config.debuglevel > 1) return;
	if (!colors) global.colors = require('colors');
	console.log('send'.grey + '  ' + text);
};

global.error = function (text) {
	if (!colors) global.colors = require('colors');
	console.log('error'.red + ' ' + text);
};

global.ok = function (text) {
	if (Config.debuglevel > 4) return;
	if (!colors) global.colors = require('colors');
	console.log('ok'.green + '    ' + text);
};

global.toId = function (text) {
	return text.toLowerCase().replace(/[^a-z0-9]/g, '');
};

global.stripCommands = function (text) {
	text = text.trim();
	if (text.charAt(0) === '/') return '/' + text;
	if (text.charAt(0) === '!' || /^>>>? /.test(text)) return ' ' + text;
	return text;
};

function runNpm(command) {
	console.log('Running `npm ' + command + '`...');

	var child_process = require('child_process');
	var npm = child_process.spawn('npm', [command]);

	npm.stdout.on('data', function (data) {
		process.stdout.write(data);
	});

	npm.stderr.on('data', function (data) {
		process.stderr.write(data);
	});

	npm.on('close', function (code) {
		if (!code) {
			child_process.fork('main.js').disconnect();
		}
	});
}

// Check if everything that is needed is available
try {
	require('sugar');
	require('colors');
} catch (e) {
	console.log('Dependencies are not installed!');
	return runNpm('install');
}

if (!Object.select) {
	console.log('Node needs to be updated!');
	return runNpm('update');
}

// First dependencies and welcome message
var sys = require('sys');
global.colors = require('colors');

console.log('------------------------------------'.yellow);
console.log('| Welcome to Pokemon Showdown Bot! |'.yellow);
console.log('------------------------------------'.yellow);
console.log('');

// Config and config.js watching...
global.fs = require('fs');
try {
	global.Config = require('./config.js');
} catch (e) {
	error('config.js doesn\'t exist; are you sure you copied config-example.js to config.js?');
	process.exit(-1);
}

var checkCommandCharacter = function () {
	if (!/[^a-z0-9 ]/i.test(Config.commandcharacter)) {
		error('invalid command character; should at least contain one non-alphanumeric character');
		process.exit(-1);
	}
};

checkCommandCharacter();

var watchFile = function () {
	try {
		return fs.watchFile.apply(fs, arguments);
	} catch (e) {
		error('your version of node does not support `fs.watchFile`');
	}
};

if (Config.watchconfig) {
	watchFile('./config.js', function (curr, prev) {
		if (curr.mtime <= prev.mtime) return;
		try {
			delete require.cache[require.resolve('./config.js')];
			Config = require('./config.js');
			info('reloaded config.js');
			checkCommandCharacter();
		} catch (e) {}
	});
}

// And now comes the real stuff...
info('starting server');

var WebSocketClient = require('websocket').client;
global.Commands = require('./commands.js').commands;
global.Parse = require('./parser.js').parse;

var connection = null;
var queue = [];
var dequeueTimeout = null;
var lastSentAt = 0;

global.send = function (data) {
	if (!connection.connected) return false;
	
	var now = Date.now();
	var diff = now - lastSentAt;
	if (diff < MESSAGE_THROTTLE) {
		if (!dequeueTimeout) dequeueTimeout = setTimeout(dequeue, MESSAGE_THROTTLE - diff);
		queue.push(data);
		return false;
	}

	if (!Array.isArray(data)) data = [data.toString()];
	data = JSON.stringify(data);
	dsend(data);
	connection.send(data);

	lastSentAt = now;
	if (dequeueTimeout) {
		if (queue.length) {
			dequeueTimeout = setTimeout(dequeue, MESSAGE_THROTTLE);
		} else {
			dequeueTimeout = null;
		}
	}
};

function dequeue() {
	send(queue.shift());
}

var connect = function (retry) {
	if (retry) {
		info('retrying...');
	}

	var ws = new WebSocketClient();

	ws.on('connectFailed', function (err) {
		error('Could not connect to server ' + Config.server + ': ' + sys.inspect(err));
		info('retrying in one minute');

		setTimeout(function () {
			connect(true);
		}, 60000);
	});

	ws.on('connect', function (con) {
		connection = con;
		ok('connected to server ' + Config.server);

		con.on('error', function (err) {
			error('connection error: ' + sys.inspect(err));
		});

		con.on('close', function () {
			// Is this always error or can this be intended...?
			error('connection closed: ' + sys.inspect(arguments));
			info('retrying in one minute');

			setTimeout(function () {
				connect(true);
			}, 60000);
		});

		con.on('message', function (message) {
			if (message.type === 'utf8') {
				recv(sys.inspect(message.utf8Data));
				Parse.data(message.utf8Data);
			}
		});
	});

	// The connection itself
	var id = ~~(Math.random() * 900) + 100;
	var chars = 'abcdefghijklmnopqrstuvwxyz0123456789_';
	var str = '';
	for (var i = 0, l = chars.length; i < 8; i++) {
		str += chars.charAt(~~(Math.random() * l));
	}

	var conStr = 'ws://' + Config.server + ':' + Config.port + '/showdown/' + id + '/' + str + '/websocket';
	info('connecting to ' + conStr + ' - secondary protocols: ' + sys.inspect(Config.secprotocols));
	ws.connect(conStr, Config.secprotocols);
};

connect();
