function convertUint8ArrayToBinaryString(u8Array) {
    var i, len = u8Array.length,
        b_str = "";
    for (i = 0; i < len; i++) {
        b_str += String.fromCharCode(u8Array[i]);
    }
    return b_str;
}

function hex2Buf(str) {
    var r = new Uint8Array(str.length / 2);
    for (var i = 0, x = str.length, k = 0; i < x; i += 2, k++) {
        r[k] = parseInt(str.substr(i, 2), 16);
    }
    return r;
}

function doublesha(hexStr) {
    var hexStrBuf = hex2Buf(hexStr);
    var hexStrBin = convertUint8ArrayToBinaryString(hexStrBuf);
    hexStrBin = CryptoJS.enc.Latin1.parse(hexStrBin);
    var sha1 = CryptoJS.SHA256(hexStrBin);
    sha1 = sha1.toString(CryptoJS.enc.Latin1);
    sha1 = CryptoJS.enc.Latin1.parse(sha1);
    var sha2 = CryptoJS.SHA256(sha1);
    var dhash = sha2.toString();
    return dhash;
}
const changeEndianness = (string) => {
    const result = [];
    let len = string.length - 2;
    while (len >= 0) {
        result.push(string.substr(len, 2));
        len -= 2;
    }
    return result.join('');
}
const changePrevhashEndianness = (string) => {
    pieces = string.match(/.{1,8}/g);
    for (let i = 0; i < pieces.length; i++) {
        pieces[i] = changeEndianness(pieces[i]);
    }
    pieces = pieces.join('');
    return pieces;
}

let LiteDoge = class {
	constructor(options) {
		var {proxyUrl, poolUrl, username, password, authorizationFn, newJobFn, newDiffFn} = options;
		this.poolUrl = proxyUrl + poolUrl; //Ex: 'ws://47.187.209.186:8080/' + 'grlcgang.com:3333' <-- (ws/tcp bridge + mining pool)
		this.username = username;
		this.password = password;
		this.connect.bind(this);
		this.mining_work = {};
		this.authFn = authorizationFn;
		this.newJobFn = newJobFn;
		this.newDiffFn = newDiffFn;
		this.worker_limit = 4;
		this.standby_workers = [];
		this.workers = [];
	for (var i = 0; i < this.worker_limit; i++) {
	    this.standby_workers.push(new Worker('worker.js'));
		console.log(this.standby_workers);
	}
	}
	connect() {
		let messageDecoder = (data) => {
			let decoder = new FileReader(); //Used to decode blobs sent by mining pool
			decoder.onload = () => {
				var result = decoder.result.split("\n");
				for (var message of result) {
					if(message != "") {					
						this.processData(message);
					}
				}
			}
			decoder.readAsText(data);
		}
		let socket = new WebSocket(this.poolUrl);
                socket.addEventListener('message', function(event) {
		     messageDecoder(event.data);
       	        });
       	        socket.addEventListener('open', function(event) {
           	     //keepAlive();
           	     socket.send('{"id": "mining.subscribe", "method": "mining.subscribe", "params": []}\n');
                });
		this.socket = socket;
		this.messageDecoder = messageDecoder;
	}
	processData(data) {
		data = JSON.parse(data.replace(/\r?\n|\r/g));
		console.log(data);
		    if (data.id == "mining.subscribe") {
		        this.mining_work.extranonce_1 = data.result[1];
		        this.mining_work.extranonce_2 = "00000000"; //We can decide any value we want here
		        this.socket.send('{"params": ["' + this.username + '", "' + this.password + '"], "id": "mining.authorize", "method": "mining.authorize"}\n');
		        console.log('SENT: ', '{"params": ["' + this.username + '", "' + this.password + '"], "id": "mining.authorize", "method": "mining.authorize"}\n');
		    }
		    if (data.id == "mining.authorize") {
		        if (data.result && this.authFn) {
		            this.authFn(true); //Allows user to define custom actions on authorization
		        }
		        if (!data.result && this.authFn) {
		            this.authFn(false);
		        }
		    }
		    if (data.method == "mining.notify") {
			//log("New job, id#: " + data.params[0]);
			this.newJobFn(data.params[0], data); //Allows to user to define custom actions on mining work
		        this.processWork(data);
		    }
		    if (data.method == "mining.set_difficulty") {
		        this.mining_work.diff = data.params[0];
			this.newDiffFn(data.params[0]); //Allows to user to define custom actions on mining difficulty
		    }
	}
	processWork(message, is_forced) {
		if(message.params[8] || is_forced) {
		    let job_id = message.params[0]; //Unpacking the data from the pool message
		    let prevhash = message.params[1];
		    let coinb1 = message.params[2];
		    let coinb2 = message.params[3];
		    let merkle_branches = message.params[4];
		    let version = message.params[5];
		    let nbits = message.params[6];
		    let ntime = message.params[7];
		    let clean_jobs = message.params[8];
			let coinbase = coinb1 + this.mining_work.extranonce_1 + this.mining_work.extranonce_2 + coinb2;
			let merkle_root = doublesha(coinbase);
               		 for (let i = 0; i < merkle_branches.length; i++) {
                  	  merkle_root = doublesha(merkle_root + merkle_branches[i]);
               		 }
			
		        version = changeEndianness(version); //Now we need to convert endianness
		        prevhash = changePrevhashEndianness(prevhash);
		        let big_ntime = ntime;
		        ntime = changeEndianness(ntime);
		        nbits = changeEndianness(nbits);
		for (var i = 0; i < this.worker_limit; i++) {
		    console.log("Worker was made");
		    this.standby_workers[i].postMessage([version, prevhash, merkle_root, ntime, nbits, this.mining_work.diff]);
		    this.workers.push(this.standby_workers[i]);
                    this.workers[i].onmessage = (e) => {
                        if (e.data.submit) {
                            this.socket.send('{"id": "mining.submit", "method": "mining.submit", "params": ["' + this.username + '", "' + job_id + '", "00000000", "' + big_ntime + '", "' + (e.data.nonce) + '"]}\n');
                        } else if (e.data.reportHashrate) {
                            e.srcElement.hashrate = (250 * ( 1000 / (e.timeStamp - e.srcElement.timestamp)));
                            e.srcElement.timestamp = e.timeStamp;
                        }
                    }
		}
		        if (!(this.standby_workers.length == 0)) {
                while (this.standby_workers[0]) {
                    this.standby_workers.shift();
                }
            }
		for (var i = 0; i < this.worker_limit; i++) {
		   this.standby_workers.push(new Worker('worker.js'));
		}
		}
	}
	get hashrate() {
		let total_hashrate = 0;
		for (var worker of this.workers) {
			total_hashrate += worker.hashrate;
		}
		return total_hashrate;
	}
}