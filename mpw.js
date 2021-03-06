// A TextEncoder in UTF-8 to convert strings to `Uint8Array`s
const txtencoder = new TextEncoder;

// JS Web Crypto implementation of http://masterpasswordapp.com/algorithm.html
class MPW {
	constructor(name, password) {
		// Store name on the object, this is not used at all internally
		this.name = name;
		
		// Calculate the master key which will be used to calculate
		// the password seed
		this.key = MPW.calculateKey(name, password);
	}
	
	// calculateKey takes ~ 1450.000ms to complete
	static calculateKey(name, password) {
		if (!name || !name.length) {
			return Promise.reject(new Error("Argument name not present"));
		}
		
		if (!password || !password.length) {
			return Promise.reject(new Error("Argument password not present"));
		}
		
		try {
			// Convert password string to a Uint8Array w/ UTF-8
			password = txtencoder.encode(password);
			
			// Convert name string to a Uint8Array w/ UTF-8
			name = txtencoder.encode(name);
			
			// Convert MPW.NS string to a Uint8Array w/ UTF-8
			let NS = txtencoder.encode(MPW.NS);
			
			// Create salt array and a DataView representing it
			var salt = new Uint8Array(
				NS.length
				+ 4/*sizeof(uint32)*/ + name.length
			);
			let saltView = new DataView(salt.buffer, salt.byteOffset, salt.byteLength);
			let i = 0;
			
			// Set salt[0,] to NS
			salt.set(NS, i); i += NS.length;
			
			// Set salt[i,i+4] to name.length UINT32 in big-endian form
			saltView.setUint32(i, name.length, false/*big-endian*/); i += 4/*sizeof(uint32)*/;
			
			// Set salt[i,] to name
			salt.set(name, i); i += name.length;
		} catch (e) {
			return Promise.reject(e);
		}
		
		// Derive the master key w/ scrypt
		// why is buflen 64*8==512 and not 32*8==256 ?
		let key = window.scrypt(password, salt, 32768/*= n*/, 8/*= r*/, 2/*= p*/, 64/*= buflen*/);
		
		// If the Web Crypto API is supported import the key, otherwise return
		return window.crypto.subtle
			? key.then(
				// Import the key into WebCrypto to use later with sign while
				// being non-extractable
				key => window.crypto.subtle.importKey("raw", key, {
					name: "HMAC",
					hash: {
						name: "SHA-256"
					}
				}, false/*not extractable*/, [ "sign" ])/*= key*/
			)
			: key;
	}
	
	// calculateSeed takes ~ 3.000ms to complete + the time of calculateKey once
	calculateSeed(site, counter = 1, context = null, NS = MPW.PasswordNS) {
		if (!site) {
			return Promise.reject(new Error("Argument site not present"));
		}
		
		if (counter < 1 || counter > 2147483647/*Math.pow(2, 31) - 1*/) {
			return Promise.reject(new Error("Argument counter out of range"));
		}
		
		try {
			// Convert salt string to a Uint8Array w/ UTF-8
			site = txtencoder.encode(site);
			
			// Convert NS string to a Uint8Array w/ UTF-8
			NS = txtencoder.encode(NS);
			
			if (context) {
				// Convert context string to a Uint8Array w/ UTF-8
				context = txtencoder.encode(context);
			}
			
			// Create data array and a DataView representing it
			var data = new Uint8Array(
				NS.length
				+ 4/*sizeof(uint32)*/ + site.length
				+ 4/*sizeof(uint32)*/
				+ (context
					? 4/*sizeof(uint32)*/ + context.length
					: 0)
			);
			let dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
			let i = 0;
			
			// Set data[0,] to NS
			data.set(NS, i); i += NS.length;
			
			// Set data[i,i+4] to site.length UINT32 in big-endian form
			dataView.setUint32(i, site.length, false/*big-endian*/); i += 4/*sizeof(uint32)*/;
			
			// Set data[i,] to site
			data.set(site, i); i += site.length;
			
			// Set data[i,i+4] to counter UINT32 in big-endian form
			dataView.setUint32(i, counter, false/*big-endian*/); i += 4/*sizeof(uint32)*/;
			
			if (context) {
				// Set data[i,i+4] to context.length UINT32 in big-endian form
				dataView.setUint32(i, context.length, false/*big-endian*/); i += 4/*sizeof(uint32)*/;
				
				// Set data[i,] to context
				data.set(context, i); i += context.length;
			}
		} catch (e) {
			return Promise.reject(e);
		}
		
		// If the Web Crypto API is supported use it, otherwise rely on crypto-js
		if (window.crypto.subtle) {
			return this.key.then(
				// Sign data using HMAC-SHA-256 w/ this.key
				key => window.crypto.subtle.sign({
					name: "HMAC",
					hash: {
						name: "SHA-256"
					}
				}, key, data)/*= seed*/
			).then(
				// Convert the seed to Uint8Array from ArrayBuffer
				seed => new Uint8Array(seed)/*= seed*/
			);
		} else {
			return this.key.then(function (key) {
				// Create crypto-js WordArrays from Uint8Arrays data and key
				data = CryptoJS.lib.WordArray.create(data);
				key  = CryptoJS.lib.WordArray.create(key);
				
				// Sign data using HMAC-SHA-256 w/ key
				return CryptoJS.HmacSHA256(data, key)/*= key*/;
			}).then(function (hash) {
				// Create seed array and a DataView representing it
				let seed     = new Uint8Array(hash.words.length * 4/*sizeof(int32)*/);
				let seedView = new DataView(seed.buffer, seed.byteOffset, seed.byteLength);
				
				// Loop over hash.words which are INT32
				for (let i = 0; i < hash.words.length; i++) {
					// Set seed[i*4,i*4+4] to hash.words[i] INT32 in big-endian form
					seedView.setInt32(i * 4/*sizeof(int32)*/, hash.words[i], false/*big-endian*/);
				}
				
				// Return the seed Uint8Array
				return seed;
			});
		}
	}
	
	// generate takes ~ 0.200ms to complete + the time of calculateSeed
	generate(site, counter = 1, context = null, template = "long", NS = MPW.PasswordNS) {
		// Does the requested template exist?
		if (!(template in MPW.templates)) {
			return Promise.reject(new Error("Argument template invalid"));
		}
		
		// Calculate the seed
		return this.calculateSeed(site, counter, context, NS).then(function (seed) {
			// Find the selected template array
			template = MPW.templates[template];
			
			// Select the specific template based on seed[0]
			template = template[seed[0] % template.length];
			
			// Split the template string (e.g. xxx...xxx)
			return template.split("").map(function (c, i) {
				// Use MPW.passchars to map the template string (e.g. xxx...xxx)
				// to characters (e.g. c -> bcdfghjklmnpqrstvwxyz)
				let chars = MPW.passchars[c];
				
				// Select the character using seed[i + 1]
				return chars[seed[i + 1] % chars.length];
			}).join("");
		})/*= password*/;
	}
	
	// generate a password with the password namespace
	generatePassword(site, counter = 1, template = "long") {
		return this.generate(site, counter, null, template, MPW.PasswordNS);
	}
	
	// generate a username with the login namespace
	generateLogin(site, counter = 1, template = "name") {
		return this.generate(site, counter, null, template, MPW.LoginNS);
	}
	
	// generate a security answer with the answer namespace
	generateAnswer(site, counter = 1, context = "", template = "phrase") {
		return this.generate(site, counter, context, template, MPW.AnswerNS);
	}

	invalidate() {
		// Replace this.key w/ a Promise.reject
		// Preventing all future access
		this.key = Promise.reject(new Error("invalid state"));
	}
	
	static test() {
		// Pretty simple test here
		return new MPW("user", "password").generate("example.com", 0, null, "long", MPW.PasswordNS).then(function (password) {
			console.assert(password === "KezpWado2+Fazo", "Self-test failed; expected: KezpWado2+Fazo; got: " + password);
			return password === "KezpWado2+Fazo"
				? Promise.resolve()
				: Promise.reject(new Error("Self-test failed; expected: KezpWado2+Fazo; got: " + password));
		});
	}
}

// The namespace used in calculateKey
MPW.NS = "com.lyndir.masterpassword";

// The namespaces used in calculateSeed
MPW.PasswordNS = "com.lyndir.masterpassword";
MPW.LoginNS    = "com.lyndir.masterpassword.login";
MPW.AnswerNS   = "com.lyndir.masterpassword.answer";

// The templates that passwords may be created from
// The characters map to MPW.passchars
MPW.templates = {
	'maximum': [
		"anoxxxxxxxxxxxxxxxxx",
		"axxxxxxxxxxxxxxxxxno"
	],
	'long': [
		"CvcvnoCvcvCvcv",
		"CvcvCvcvnoCvcv",
		"CvcvCvcvCvcvno",
		"CvccnoCvcvCvcv",
		"CvccCvcvnoCvcv",
		"CvccCvcvCvcvno",
		"CvcvnoCvccCvcv",
		"CvcvCvccnoCvcv",
		"CvcvCvccCvcvno",
		"CvcvnoCvcvCvcc",
		"CvcvCvcvnoCvcc",
		"CvcvCvcvCvccno",
		"CvccnoCvccCvcv",
		"CvccCvccnoCvcv",
		"CvccCvccCvcvno",
		"CvcvnoCvccCvcc",
		"CvcvCvccnoCvcc",
		"CvcvCvccCvccno",
		"CvccnoCvcvCvcc",
		"CvccCvcvnoCvcc",
		"CvccCvcvCvccno"
	],
	'medium': [
		"CvcnoCvc",
		"CvcCvcno"
	],
	'basic': [
		"aaanaaan",
		"aannaaan",
		"aaannaaa"
	],
	'short': [
		"Cvcn"
	],
	'pin': [
		"nnnn"
	],
	'name': [
		"cvccvcvcv"
	],
	'phrase': [
		"cvcc cvc cvccvcv cvc",
		"cvc cvccvcvcv cvcv",
		"cv cvccv cvc cvcvccv"
	]
};

// The password character mapping
// c in template becomes bcdfghjklmnpqrstvwxyz
MPW.passchars = {
	V: "AEIOU",
	C: "BCDFGHJKLMNPQRSTVWXYZ",
	v: "aeiou",
	c: "bcdfghjklmnpqrstvwxyz",
	A: "AEIOUBCDFGHJKLMNPQRSTVWXYZ",
	a: "AEIOUaeiouBCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz",
	n: "0123456789",
	o: "@&%?,=[]_:-+*$#!'^~;()/.",
	x: "AEIOUaeiouBCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz0123456789@&%?,=[]_:-+*$#!'^~;()/.",
	" ": " "
};
