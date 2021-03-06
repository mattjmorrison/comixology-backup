//(C) 2013 Sperglord Enterprises
//Code is under GNUGPLv3 - read http://www.gnu.org/licenses/gpl.html

var overlay = document.createElement("div");

overlay.style.position = "fixed";
overlay.style.zIndex = 299;
overlay.style.top = overlay.style.left = overlay.style.bottom = overlay.style.right = 0;
overlay.style.width = overlay.style.height = "auto";
overlay.style.background = "rgba(0,0,0,0.3)";
overlay.style.display = "none";
document.documentElement.appendChild(overlay);

//ENTRANCE POINT FOR READER BACKUP LOGIC:

var port = connector.connect({ name:"reader" }),
	delayMeasurement;

getSettings(function() {
	
	// Disable delays if measurements for latency compensation were disabled in the settings:
	if(!settings.latency)
		delayMeasurement = {
			start: function() {},
			stop: function() {},
			timeout: function(c) { c(); }
		};
	else
		delayMeasurement = {
			timestamp: null,
			delay: 0,
			start: function() {
				this.timestamp = Date.now();
			},
			stop: function() {
				if(!this.timestamp)
					return;
				var diff = Date.now()-this.timestamp;
				if(diff > this.delay)
					this.delay = diff;
				this.timestamp = null;
			},
			timeout: function(callback) {
				if(this.delay)
					setTimeout(callback, this.delay);
				else
					callback();
			}
		};
	
	// delete cached uncompleted zip-backups for this tab:
	port.send({ what:"is_child" }, function(isChild) { // tab opened by extension -> autorun / else -> show bar
		if(!isChild) {
			if(!settings.selectors)
				displayExploitBar();
			return;
		}
		
		port.send({ what:"message_to_opener", message:{ what:"ready_to_download" } }, function(start) {
			if(start)
				if(start.download)
					loadComic(function() {
						port.send({ what:"message_to_opener", message:{ what:"finished_download" } });
					}, function(perc) {
						port.send({ what:"message_to_opener", message:{ what:"download_progress", data:perc } });
					});
				else if(start.exploit) {
					port.send({ what:"unlink_from_opener" });
					setupSelectors();
				}
					
		});
	});
});

// show orange bar: asking for exploit scan
function displayExploitBar() {
	addTopBar();
	div.style.lineHeight = "25px";
	div.innerHTML = "Do you want to start an exploit scan? This is required to backup comics.<br><a href=\"javascript:document.documentElement.removeChild(document.getElementById('"+div.id+"'))\" style='"+linkStyle+"'>No</a> ";
	var a = document.createElement("a");
	a.innerHTML = "Yes";
	a.href = "#";
	a.addEventListener('click', function(e) {
		e.stopPropagation();
		setupSelectors();
	}, false);
	a.setAttribute("style", linkStyle);
	div.appendChild(a);
}

function getPathFor(e, tryE) { // returns css selector that matches e and tryE as well (if that is possible, without two comma seperated selectors) - only tags, ids and classes are used
	if(!e)
		return "";
	if(e.id)
		return "#"+e.id;
	var before = getPathFor(e.parentElement)+" > "+e.tagName,
		classes = "", classesBefore,
		p = 0,
		selection = document.querySelectorAll(before), selectionBefore,
		couldMatch = function() { // returns true if the current state of path could also match tryE (directly or if it was specified further)
			if(!tryE)
				return true;
			var c = tryE;
			while(c) {
				if(c.matches(before+classes))
					return true;
				c = tryE.parentElement;
			}
			return false;
		};
	if(e.classList.length) do {
		classesBefore = classes;
		classes += "."+e.classList[p++];
		selectionBefore = selection.length;
		selection = document.querySelectorAll(before+classes);
		if(selection.length >= selectionBefore || !couldMatch())
			classes = classesBefore;
	} while(p < e.classList.length && selection.length > 1);
	return before+classes;
}

function wordDiff(text1, text2) { // word wise difference of two strings (using diff_match_patch library)
	
	text1 = text1.trim()+" ";
	text2 = text2.trim()+" ";
	
	var lineArray = [];  // e.g. lineArray[4] == 'Hello\n'
	var lineHash = {};   // e.g. lineHash['Hello\n'] == 4
	
	// '\x00' is a valid character, but various debuggers don't like it.
	// So we'll insert a junk entry to avoid generating a null character.
	lineArray[0] = '';
	
	/**
	* Split a text into an array of strings.  Reduce the texts to a string of
	* hashes where each Unicode character represents one line.
	* Modifies linearray and linehash through being a closure.
	* @param {string} text String to encode.
	* @return {string} Encoded string.
	* @private
	*/
	function diff_linesToCharsMunge_(text) {
		var chars = '';
		// Walk the text, pulling out a substring for each line.
		// text.split('\n') would would temporarily double our memory footprint.
		// Modifying text would create many large strings to garbage collect.
		var lineStart = 0;
		var lineEnd = -1;
		// Keeping our own length variable is faster than looking it up.
		var lineArrayLength = lineArray.length;
		while (lineEnd < text.length - 1) {
			lineEnd = text.indexOf(' ', lineStart);
			if (lineEnd == -1) {
				lineEnd = text.length - 1;
			}
			var line = text.substring(lineStart, lineEnd + 1);
			lineStart = lineEnd + 1;
			
			if (lineHash.hasOwnProperty ? lineHash.hasOwnProperty(line) :
				(lineHash[line] !== undefined)) {
				chars += String.fromCharCode(lineHash[line]);
			} else {
				chars += String.fromCharCode(lineArrayLength);
				lineHash[line] = lineArrayLength;
				lineArray[lineArrayLength++] = line;
			}
		}
		return chars;
	}
	
	var chars1 = diff_linesToCharsMunge_(text1);
	var chars2 = diff_linesToCharsMunge_(text2),
	
		dmp = new diff_match_patch(),
		result = dmp.diff_main(chars1, chars2, false);
		
	dmp.diff_charsToLines_(result, lineArray);
	return result;
}

function realClick(e) { // simulate a "real" click on given DOMElement e (can't be distinguished from a user click)
	if(!e)
		return;
	var evt = document.createEvent("MouseEvents"),
		rect = e.getBoundingClientRect(),
		doc = e.ownerDocument,
		win = (doc && (doc.defaultView || doc.parentWindow)) || window,
		left = rect.left || 1,
		top = rect.top || 1;
	evt.initMouseEvent("click", true, true, win, 1, left, top, left, top, false, false, false, false, 0, null);
	e.dispatchEvent(evt);
}

var dom = { // stores DOM elements of the reader page. All DOM calls go here. No queries elsewhere to make it easier to adapt to reader changes.
	pagesCached: null,
	canvasContainer: null,
	browseButtonCached: null,
	onepageButtonCached: null,
	
	isVisible: function(e) {
		return e.style.display != "none" && e.style.visibility != "hidden";
	},

	get pages() {
		return this.pagesCached = this.pagesCached || document.querySelectorAll(settings.selectorPages);
	},
	get activePage() {
		return document.querySelector(settings.selectorActivePage);
	},
	
	loopCanvasContainers: function(f) {
		var a = document.querySelectorAll("div.view"),
			v;
		for (var i = 0; i < a.length; i++)
			if(this.isVisible(a[i]) && (v = f(a[i])))
				return v;
		return null;
	},
	
	getCanvasContainer: function() {
		var t = this;
		if(t.canvasContainer && document.contains(t.canvasContainer) && t.isVisible(t.canvasContainer))
			return this.canvasContainer;
		return t.canvasContainer = t.loopCanvasContainers(function(a) {
			return a;
		});
	},
	get canvasElements() {
		return this.canvasContainer.querySelectorAll("canvas");
	},
	get browseButton() {
		return this.browseButtonCached = this.browseButtonCached || document.querySelector(settings.selectorBrowseButton);
	},
	get onepageButton() {
		return this.onepageButtonCached = this.onepageButtonCached || document.querySelector(settings.selectorOnepageButton);
	},
	get activeOnepageButton() {
		return document.querySelector(settings.selectorActiveOnepageButton);
	},
	get pagenumAttr() {
		return settings.pagenumAttr;
	},
	get pagenumCorrection() {
		return settings.pagenumCorrection;
	},
	get loader() {
		return document.querySelector(".loading");
	},
	loaderVisible: function() {
		return this.loader && this.loader.style.display != "none";
	},
	isActivePage: function(page) {
		return page.matches(settings.selectorActivePage);
	},
	isActiveOnepageButton: function() {
		return this.onepageButton.matches(settings.selectorActiveOnepageButton);
	},
	countCanvas: function() {
		return this.canvasElements.length;
	},
	countCanvasContainers: function() {
		var i = 0;
		this.loopCanvasContainers(function() {
			i++;
			return false;
		});
		return i;
	}
};

function setupSelectors() { // run a DOM scan to analyse how the reader DOM tree is structured and how it should be backuped
	/*
		- click single page button
		- click dual page button
		- click browse pages button
		- click first page
		- click second page
		- click on opened comic page
	*/
	addTopBar();
	window.alert("A new exploit scan has to be made.\nPlease follow the upcoming instructions or the extension may stop working for you.");
	var step = -1, // counter: where are we in the setup process?
		level = function(s, a) { // toggle between two activatable elements (e.g. opened pages) s and a. Goes up the DOM starting at s until the toggle causes a change of the class-attr of the current ascendant of s. -> the ascendant and the added/removed classes per toggle are returned.
			if(!s)
				return null;
			var classBefore = s.className,
				classAfter;
			realClick(s);
			classAfter = s.className;
			realClick(a);
			if(classBefore == classAfter)
				return level(s.parentElement, a);
			return {
				e:s,
				diff: wordDiff(classBefore, classAfter)
			};
		}, extendPath = function(path, classDiffList) { // add css-class selectors to a given css-selector path. classDiffList is a two dimensional array. the outer array contains all classes that should be added. the inner arrays have two elements: [0]=> -1/0/1 (require class not to be there / ignore this class / require class to be there), [1] => class name
			for (var i = 0; i < classDiffList.length; i++) {
				if(!classDiffList[i][0])
					continue;
				var w = classDiffList[i][1].trim();
				if(w.length)
					path += classDiffList[i][0]==1?"."+w:":not(."+w+")";
			}
			return path;
		},
		write = { selectors:1, scannedOnce:1 },
		steps = [ // steps array contains all the steps of the setup wizard. each step has a text that is displayed to the user, explaining what to do. callback will be called as soon as the user clicks some element on the page (clicked element is passed as parameter). boolean return value of callback determines if setup should be continued or if an error occured.
			{
				text: "Click the button that enables single page view.",
				btn: null,
				callback: function(element) {
					this.btn = element;
					return !!this.btn;
				}
			}, {
				text: "Click the button that enables dual page view.",
				callback: function(dual) {
					var single = steps[0].btn,
						states = level(single, dual);
					if(!states)
						return false;
					var inactive = getPathFor(states.e),
						active = extendPath(inactive, states.diff);
					realClick(single);
					write.selectorOnepageButton = inactive;
					write.selectorActiveOnepageButton = active;
					return inactive && active;
				}
			}, {
				text: "Click the browse button that shows all pages.",
				callback: function(element) {
					var btn = getPathFor(element);
					write.selectorBrowseButton = btn;
					return !!btn;
				}
			}, {
				text: "Click on the thumbnail of the first page.",
				callback: function(element) {
					this.page = element;
					return this.page;
				}
			}, {
				text: "Click on the thumbnail of the second page.",
				callback: function(second) {
					var first = steps[3].page,
						states = level(first, second);
					if(!states)
						return false;
					var inactive = getPathFor(states.e, second),
						active = extendPath(inactive, states.diff),
						attrs = states.e.attributes,
						smallestIntAttr = null;
					if(document.querySelectorAll(inactive).length <= 1)
						return false;
					for (var i = 0, v; i < attrs.length; i++) {
						v = attrs[i].value.trim();
						if(v != "" && isFinite(v) && !(v%1) && (smallestIntAttr === null || smallestIntAttr.value > v*1))
							smallestIntAttr = { value:v*1, name:attrs[i].name };
					}
					write.selectorPages = inactive;
					write.selectorActivePage = active;
					write.pagenumAttr = smallestIntAttr.name;
					write.pagenumCorrection = smallestIntAttr.value;
					return inactive && active && smallestIntAttr;
				}
			}
		],
		waiter = function() {},
		listener,
		nextStep = function() {
			if(++step >= steps.length)
				return end();
			div.innerHTML = (step+1)+". "+steps[step].text;
			div.style.lineHeight = "50px";
			waiter = function(p) {
				if(steps[step].callback(p))
					nextStep();
				else
					fail();
			};
		},
		
		end = function() {
			window.alert("Scan completed.\nIf the backup still does not work, you should force a new scan in the options.");
			document.documentElement.removeAttribute("scanning");
			document.documentElement.removeEventListener("click", listener, false);
			chrome.storage.local.set(write, function() {
				for (var key in write)
					settings[key] = write[key];
				div.style.height = "auto";
				div.style.lineHeight = "18px";
				div.style.top = 0;
				div.style.marginTop = 0;
				div.innerHTML = "<b style='font-size:1.2em;display:block;margin-bottom:15px;margin-top:15px;'>Just one more thing!</b>Make sure you disabled the <i>Prompt to continue</i> message in the settings.<br>Click the gear on the bottom of this page to check.<br>If you do not disable that message, backups won't work.<br><a href=\"javascript:document.documentElement.removeChild(document.getElementById('"+div.id+"'))\" style='"+linkStyle+"width:auto;margin-bottom:10px;margin-top:10px;'>OK. I checked it.</a>";
				port.send({ what:"broadcast_to_openers", message:{ what:"finished_scan" } });
			});
		}, fail = function() {
			window.alert("Sorry. The scan failed.\nMaybe you should try again.");
			window.location.reload();
		};
	
	document.documentElement.setAttribute("scanning", "1");
	
	document.documentElement.addEventListener("click", listener = function(e) {
		var w = waiter;
		waiter = function() {};
		w(e.target);
	}, false);
	
	nextStep(); // start with first setup instruction
}

// download the opened comic. a callback and a step function can be used.
function loadComic(callback, step) {
	
	addTopBar();
	overlay.style.display = "block";
	
	div.innerHTML = "Downloading comic... <span>0</span>%";
	div.style.lineHeight = "50px";
	
	if(typeof callback != "function")
		callback = function() {};
	if(typeof step != "function")
		step = function() {};
	
	if(!dom.getCanvasContainer() || dom.loaderVisible() || !dom.countCanvas()) // delay download if comic isn't displayed yet => reader not ready, first page is not loaded yet, first page is not displayed yet
		return setTimeout(function() {
			loadComic(callback, step);
		}, 100);
	var pos = -1,
		l = dom.pages.length,
		numLength = String(l-1).length,
		nextPage = function(callback) {
			pos++;
			if (pos >= l) {
				changeWaiter = null;
				end();
				return;
			}
			var fig = dom.pages[pos];
			if (dom.isActivePage(fig)) {
				changeWaiter = null;
				callback();
			}
			else {
				changeWaiter = callback;
				delayMeasurement.timeout(function() {
					delayMeasurement.start();
					realClick(fig);
				});
			}
		}, changeWaiter = null,
		interval = function() {
			nextPage(function() {
				var bef = dom.canvasContainer;
				dom.getCanvasContainer();
				getOpenedPage(function(page) {
					port.send({ what:"add_page", page:(settings.container!=2?page:null), i:pos, len:numLength, extension:(settings.page?"png":"jpeg"), toZip:(settings.container!=2) }, function(result) {
						if(settings.container == 2)
							downloadData(getName()+"/"+result.name, page, true);
						
						var perc = Math.round((pos + 1) / l * 100);
						div.getElementsByTagName("span")[0].innerHTML = perc;
						step(perc);
						interval();
					});
				});
			});
		}, start = function() {
			start = function() {};
			interval();
		}, end = function() {
			dom.getCanvasContainer().parentElement.removeEventListener("DOMNodeRemoved", rmListener, false);
			step("zip");
			zipImages(function() {
				step("save");
				downloadBlob(getName()+"."+(settings.container?"zip":"cbz"), function() {
					document.documentElement.removeChild(div);
					document.documentElement.removeChild(overlay);
					realClick(firstPageFig);
					callback();
				});
			});
		}, rmListener = function(e) {
			delayMeasurement.stop();
			if (typeof changeWaiter === "function" && (!dom.countCanvas() || !dom.isVisible(dom.canvasContainer))) {
				changeWaiter();
				changeWaiter = null;
			}
			else
				start();
		}, firstPage = 0, firstPageFig = null;

	port.send({ what:"new_zip", user:getUsername() }, function() {
		dom.getCanvasContainer().parentElement.addEventListener("DOMNodeRemoved", rmListener, false);
		realClick(dom.browseButton);
		firstPageFig = dom.activePage;
		firstPage = (firstPageFig && firstPageFig.getAttribute(dom.pagenumAttr)*1+dom.pagenumCorrection) || 0;
		pos = settings.start?firstPage-1:-1;
		if(dom.isActiveOnepageButton())
			start();
		else {
			realClick(dom.onepageButton);
			var check = function() {
				setTimeout(function() {
					if(dom.isActiveOnepageButton())
						start();
					else
						check();
				}, 100);
			};
			check();
		}
	});
}

function getName() {
	if(getName.title != null)
		return getName.title;
	var title = document.getElementsByTagName('title');
	if(title[0])
		return getName.title = title[0].innerHTML.substr(0, title[0].innerHTML.lastIndexOf("-")).trim().replace(/\s/g, "_").replace(/[^a-z0-9#.()\[\]_-]/gi, "");
	return "comic";
}
getName.title = null;

function getUsername() {
	var reader = document.getElementById("reader");
	return (reader && reader.getAttribute("data-username")) || "";
}

function getUsernameImage(ctx, w, h) {
	var uName = getUsername(),
		uW = (uName.length+1)*8,
		data = ctx.getImageData(w-uW, h-1, uW, 1),
		p, c, i, e, q, hsl, rgb;
	for (i = -1; i < uName.length; i++) {
		p = (i+1)*32;
		c = nullFill(i<0?"00000000":Number(uName.charCodeAt(i)).toString(2), 8);
		for (e = 0; e < c.length; e++) {
			q = p+e*4;
			hsl = rgbToHsl(data.data[q], data.data[q+1], data.data[q+2]);
			if(c.charAt(e)*1 && hsl[2] < 0.65)
				hsl[2] = 0.65;
			else if(!(c.charAt(e)*1) && hsl[2] > 0.35)
				hsl[2] = 0.35;
			rgb = hslToRgb(hsl[0], hsl[1], hsl[2]);
			data.data[q] = rgb[0];
			data.data[q+1] = rgb[1];
			data.data[q+2] = rgb[2];
		}
	}
	
	return data;
}

function downloadBlob(name, callback) { // overwrite is not used currently
	// blobs have to be downloaded from background page (same origin policy)
	port.send({ what:"download_blob", name:name }, callback);
}
function downloadData(name, data, overwrite, callback) { // overwrite is not used currently
	var url = URL.createObjectURL(dataURLtoBlob(data));
	downloadFile(name, url, overwrite, function() {
		URL.revokeObjectURL(url);
		callback();
	});
}

// compress and download all pages that were backuped by this tab in the loadComic function
function zipImages(callback) {
	if(settings.container == 2)
		return typeof callback === "function"?callback():undefined;
	div.innerHTML = "Zipping images...";
	div.style.lineHeight = "50px";

	port.send({ what:"start_zipping" }, function(result) {
		div.innerHTML = "Saving comic...";
		callback();
	});
}

// get data URL of the currently opened page in the reader (async! result is given to callback)
function getOpenedPage(callback) {
	var view = dom.getCanvasContainer(),
		doneLoading = view && (view.style.webkitTransform || view.style.transform) && !dom.loaderVisible();
	if(doneLoading) {
		var canvasOnThisPage = dom.canvasElements,
			w = parseInt(view.style.width),
			h = parseInt(view.style.height),
			outCanvas = document.createElement('canvas'),
			ctx = outCanvas.getContext('2d'),
			canvas, data;
		outCanvas.width = w;
		outCanvas.height = h;
		for (var i = 0; i < canvasOnThisPage.length; i++) {
			canvas = canvasOnThisPage[i];
			ctx.drawImage(canvas, parseInt(canvas.style.left)||0, parseInt(canvas.style.top)||0, parseInt(canvas.style.width)||0, parseInt(canvas.style.height)||0);
		}
		data = getUsernameImage(ctx, w, h);
		ctx.putImageData(data, w-data.width, h-data.height);
		
		callback(outCanvas.toDataURL("image/"+(settings.page?"png":"jpeg")));
	}
	else {
		setTimeout(function() {
			getOpenedPage(callback);
		}, 300);
	}
}