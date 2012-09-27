var PORT = process.argv[2];
var SECRET_KEY = process.argv[3] || null;
var HOST = '127.0.0.1';

var initialized = {};

var net = require('net');
var formatter = require('./formatter');

var send = function(socket, object) {
	socket.write(formatter.stringify(object));
}

var isEmpty = function(object) {
	var i;
	var empty = true;
	for(i in object) {
		empty = false;
		break;
	}
	return empty;
}

var FlexiMap = function(object) {
	var self = this;
	self.length = 0;
	self._data = [];
	
	self._isEmpty = function(object) {
		var i;
		var empty = true;
		for(i in object) {
			empty = false;
			break;
		}
		return empty;
	}
	
	self._isIterable = function(object) {
		return Object.prototype.toString.call(object) == "[object Object]" || object instanceof Array;
	}
	
	self.getLength = function() {
		return self._data.length;
	}
	
	if(object) {
		var i;
		if(self._isIterable(object)) {
			for(i in object) {
				if(self._isIterable(object[i])) {
					self._data[i] = new FlexiMap(object[i]);
				} else {
					self._data[i] = object[i];
				}
			}
		} else {
			self._data.push(object);
		}
	}
	
	self._isInt = function(input) {
		return /^[0-9]+$/.test(input);
	}
	
	self._getValue = function(key) {
		return self._data[key];
	}
	
	self._setValue = function(key, value) {
		self._data[key] = value;
	}
	
	self._deleteValue = function(key) {
		delete self._data[key];
		if(self._isInt(key)) {
			self._data.splice(key, 1);
		}
	}
	
	self._get = function(keyChain) {
		var key = keyChain[0];
		var data = self._getValue(key);
		if(keyChain.length < 2) {
			return data;
		} else {
			if(data instanceof FlexiMap) {
				return data._get(keyChain.slice(1));
			} else {
				return null;
			}
		}
	}
	
	self.get = function(keyPath) {
		var keyChain = keyPath.split('.');
		return self._get(keyChain);
	}
	
	self.hasImmediateKey = function(key) {
		return self._data[key] !== undefined;
	}
	
	self.hasKey = function(keyPath) {
		return self.get(keyPath) ? true : false;
	}
	
	self._set = function(keyChain, value) {
		var key = keyChain[0];
		if(keyChain.length < 2) {
			if(!(value instanceof FlexiMap) && self._isIterable(value)) {
				value = new FlexiMap(value);
			}
			self._setValue(key, value);
		} else {
			if(!self.hasImmediateKey(key) || !(self._getValue(key) instanceof FlexiMap)) {
				self._setValue(key, new FlexiMap());
			}
			self._getValue(key)._set(keyChain.slice(1), value);
		}
	}
	
	self.set = function(keyPath, value) {
		var keyChain = keyPath.split('.');
		self._set(keyChain, value);
	}
	
	self.add = function(keyPath, value) {
		var target = self.get(keyPath);
		
		if(!target) {
			target = new FlexiMap([value]);
			self.set(keyPath, target);
		} else if(!(target instanceof FlexiMap)) {
			target = new FlexiMap([target, value]);
			self.set(keyPath, target);
		} else {
			self.set(keyPath + '.' + target.getLength(), value);
		}
	}
	
	self._remove = function(key) {
		if(self.hasImmediateKey(key)) {
			var data = self._getValue(key);
			self._deleteValue(key);
			
			if(data instanceof FlexiMap) {
				return data.getData();
			} else {
				return data;
			}
		} else {
			return null;
		}
	}
	
	self.remove = function(keyPath) {
		var keyChain = keyPath.split('.');
		if(keyChain.length < 2) {
			return self._remove(keyChain[0]);
		}
		var parentMap = self._get(keyChain.slice(0, -1));
		return parentMap._remove(keyChain[keyChain.length - 1]);
	}
	
	self.pop = function(keyPath) {
		var target = self.get(keyPath);
		if(!target) {
			return null;
		}
		if(!(target instanceof FlexiMap) || target.getLength() < 1) {
			return self.remove(keyPath);
		}
		
		return self.remove(keyPath + '.' + (target.getLength() - 1));
	}
	
	self.removeAll = function() {
		self._data = [];
	}
	
	self._arrayToObject = function(array) {
		var i;
		var obj = {};
		for(i in array) {
			obj[i] = array[i];
		}
		return obj;
	}
	
	self.getData = function() {
		var isArray = (self._data.length > 0) ? true : false;
		var i;
		
		for(i in self._data) {
			if(self._data[i] instanceof FlexiMap) {
				self._data[i] = self._data[i].getData();
			}
		}
		
		if(isArray) {
			var len = self._data.length;
			
			for(i=0; i<len; i++) {
				if(self._data[i] === undefined) {
					isArray = false;
					break;
				}
			}
		}
		
		if(isArray) {
			for(i in self._data) {
				if(!self._isInt(i)) {
					isArray = false;
					break;
				}
			}
		}
		
		if(isArray) {
			return self._data;
		}
		
		return self._arrayToObject(self._data);
	}
}

var dataMap = new FlexiMap();
var watchMap = {};

var actions = {
	init: function(command, socket) {	
		var result = {id: command.id, type: 'response', action: 'init'};
		
		if(command.secretKey == SECRET_KEY) {
			initialized[socket.id] = true;
		} else if(SECRET_KEY) {
			result.error = 'nData Error - Invalid password was supplied to nData';
		}
		
		send(socket, result);
	},

	set: function(command, socket) {
		dataMap.set(command.key, command.value);
		send(socket, {id: command.id, type: 'response', action: 'set'});
	},
	
	add: function(command, socket) {
		dataMap.add(command.key, command.value);
		send(socket, {id: command.id, type: 'response', action: 'add'});
	},
	
	remove: function(command, socket) {
		var result = dataMap.remove(command.key);
		send(socket, {id: command.id, type: 'response', action: 'remove', value: result});
	},
	
	removeAll: function(command, socket) {
		dataMap.removeAll();
		send(socket, {id: command.id, type: 'response', action: 'removeAll'});
	},
	
	pop: function(command, socket) {
		var result = dataMap.pop(command.key);
		send(socket, {id: command.id, type: 'response', action: 'pop', value: result});
	},
	
	get: function(command, socket) {
		var result = dataMap.get(command.key);
		if(result instanceof FlexiMap) {
			result = result.getData();
		}
		send(socket, {id: command.id, type: 'response', action: 'get', value: result});
	},
	
	getAll: function(command, socket) {
		send(socket, {id: command.id, type: 'response', action: 'getAll', value: dataMap.getData()});
	},
	
	watch: function(command, socket) {
		if(!watchMap.hasOwnProperty(command.event)) {
			watchMap[command.event] = {};
		}
		var exists = watchMap[command.event].hasOwnProperty(socket.id);
		watchMap[command.event][socket.id] = socket;
		send(socket, {id: command.id, type: 'response', action: 'watch', event: command.event});
	},
	
	unwatch: function(command, socket) {
		if(command.event) {
			if(watchMap.hasOwnProperty(command.event) && watchMap[command.event].hasOwnProperty(socket.id)) {
				delete watchMap[command.event][socket.id];
				if(isEmpty(watchMap[command.event])) {
					delete watchMap[command.event];
				}
			}
			send(socket, {id: command.id, type: 'response', action: 'unwatch', event: command.event});
		} else {
			watchMap = {};
			send(socket, {id: command.id, type: 'response', action: 'unwatch', event: null});
		}
	},
	
	broadcast: function(command, socket) {
		if(watchMap[command.event]) {
			var i;
			for(i in watchMap[command.event]) {
				send(watchMap[command.event][i], {type: 'event', event: command.event, value: command.value});
			}
		}
		send(socket, {id: command.id, type: 'response', action: 'broadcast', value: command.value, event: command.event});
	}
}

var curID = 1;

var genID = function() {
	return curID++;
}

var server = net.createServer();

server.listen(PORT, HOST);

server.on('connection', function(sock) {
	sock.id = genID();
	sock.on('data', function(commandBuffer) {
		var commands = formatter.parse(commandBuffer, true);
		var i;
		for(i in commands) {
			if(!SECRET_KEY || initialized.hasOwnProperty(sock.id) || commands[i].action == 'init') {
				if(actions.hasOwnProperty(commands[i].action)) {
					actions[commands[i].action](commands[i], sock);
				}
			} else {
				send(sock, {id: commands[i].id, type: 'response', action: commands[i].action, error: 'nData Error - Cannot process command before init handshake'});
			}
		}
	});
	
	sock.on('close', function() {
		if(initialized.hasOwnProperty(sock.id)) {
			delete initialized[sock.id];
		}
	});
});

server.on('listening', function() {
	process.send({event: 'listening'});
});