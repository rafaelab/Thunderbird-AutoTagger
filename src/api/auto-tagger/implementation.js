var { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
var { setTimeout, clearTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");

const SENT_DAYS = 180; // Sent messages older than this are left alone.
const MAX_THREAD = 100; // Larger threads are skipped: they usually come from broken References headers.
const DELAY = 1000; // Waits this long (ms) for more changes before syncing the threads.
const RETRY = 5000; // Waits this long (ms) while a folder is busy, e.g. archiving or compacting.
const CHUNK = 200; // Filters this many messages at a time, so that Thunderbird stays responsive.

let listening = false;
let pending = []; // Tag changes and new messages waiting for the next sync.
let timer = null;
let filtering = false; // True while the button runs the filters; the sync waits for them.
let writing = false; // True while the sync changes tags, so that it ignores its own changes.

var AutoTagger = class extends ExtensionAPI {
	getAPI(context) {
		return {
			AutoTagger: {
				async start() {
					if (!listening) {
						MailServices.mfn.addListener(listener, MailServices.mfn.msgAdded | MailServices.mfn.msgPropertyChanged);
						listening = true;
					}
				},
				runFilters
			}
		};
	}

	onShutdown() {
		MailServices.mfn.removeListener(listener);
		listening = false;
		clearTimeout(timer);
	}
};

// The scope: the Inbox and Sent folders of Local Folders, and in Sent only the messages of the
// last SENT_DAYS days.
function isScopeFolder(folder) {
	let { Inbox, SentMail, Virtual } = Ci.nsMsgFolderFlags;
	return folder.server.key == MailServices.accounts.localFoldersServer.key && folder.flags & (Inbox | SentMail) && !(folder.flags & Virtual);
}

function scopeFolders() {
	return MailServices.accounts.localFoldersServer.rootFolder.descendants.filter(isScopeFolder);
}

function inScope(hdr) {
	let folder = hdr.folder;
	return isScopeFolder(folder) && (folder.flags & Ci.nsMsgFolderFlags.Inbox || hdr.dateInSeconds > Date.now() / 1000 - SENT_DAYS * 86400);
}

function scopeMessages(folder) {
	return [...folder.msgDatabase.enumerateMessages()].filter(inScope);
}

// The tag keys of a "keywords" string; other keywords, such as $Forwarded or junk, are ignored.
function tagsOf(keywords) {
	return keywords.toLowerCase().split(" ").filter(key => key && MailServices.tags.isValidKey(key));
}

function referencesOf(hdr) {
	let references = [];
	for (let i = 0; i < hdr.numReferences; i++) {
		references.push(hdr.getStringReference(i));
	}
	return references.filter(Boolean);
}

// Thunderbird calls the listener for the messages of every account; it only records the changes of
// the scope, and the sync applies them a moment later.
let listener = {
	QueryInterface: ChromeUtils.generateQI(["nsIMsgFolderListener"]),

	msgAdded(hdr) {
		record(hdr, { inherit: true });
	},

	msgPropertyChanged(hdr, property, oldValue, newValue) {
		if (property != "keywords" || writing) {
			return;
		}
		let before = tagsOf(oldValue);
		let after = tagsOf(newValue);
		let added = after.filter(tag => !before.includes(tag));
		let removed = before.filter(tag => !after.includes(tag));
		if (added.length || removed.length) {
			record(hdr, { added, removed });
		}
	}
};

function record(hdr, change) {
	try {
		if (inScope(hdr)) {
			pending.push({ id: hdr.messageId, references: referencesOf(hdr), ...change });
			schedule(DELAY);
		}
	} catch (e) {
		console.error("AutoTagger: could not record a change.", e);
	}
}

function schedule(delay) {
	clearTimeout(timer);
	timer = setTimeout(sync, delay);
}

// Applies the pending changes to their threads. Messages that refer to each other (Message-ID,
// References, In-Reply-To) are in the same thread, also across Inbox and Sent:
// - a tag added to or removed from a message is added to or removed from its whole thread;
// - a new message receives the tags of the other messages of its thread.
function sync() {
	timer = null;
	if (filtering || !pending.length) {
		return; // runFilters() syncs when the filters have finished.
	}
	try {
		let folders = scopeFolders();
		if (folders.some(folder => folder.locked)) {
			schedule(RETRY);
			return;
		}
		let changes = pending;
		pending = [];
		let start = Date.now();

		// Union-find: threadOf() gives the same id for all Message-IDs of a thread.
		let parents = new Map();
		let threadOf = id => {
			if (!parents.has(id)) {
				parents.set(id, id);
			}
			while (parents.get(id) !== id) {
				parents.set(id, parents.get(parents.get(id)));
				id = parents.get(id);
			}
			return id;
		};
		let join = (a, b) => parents.set(threadOf(a), threadOf(b));

		let messages = folders.flatMap(scopeMessages);
		for (let hdr of messages) {
			referencesOf(hdr).forEach(reference => join(reference, hdr.messageId));
		}
		for (let change of changes) {
			change.references.forEach(reference => join(reference, change.id));
		}

		let threads = new Map();
		let current = new Map();
		let wanted = new Map();
		for (let hdr of messages) {
			let thread = threadOf(hdr.messageId);
			if (!threads.has(thread)) {
				threads.set(thread, []);
			}
			threads.get(thread).push(hdr);
			current.set(hdr, tagsOf(hdr.getStringProperty("keywords")));
			wanted.set(hdr, new Set(current.get(hdr)));
		}

		for (let change of changes) {
			let thread = threads.get(threadOf(change.id)) ?? [];
			if (thread.length > MAX_THREAD) {
				console.warn(`AutoTagger: skipped the thread of ${change.id}: ${thread.length} messages.`);
				continue;
			}
			if (change.inherit) {
				let inherited = thread.filter(hdr => hdr.messageId != change.id).flatMap(hdr => [...wanted.get(hdr)]);
				for (let hdr of thread.filter(hdr => hdr.messageId == change.id)) {
					inherited.forEach(tag => wanted.get(hdr).add(tag));
				}
			} else {
				for (let hdr of thread) {
					change.added.forEach(tag => wanted.get(hdr).add(tag));
					change.removed.forEach(tag => wanted.get(hdr).delete(tag));
				}
			}
		}

		// One call per folder and tag, with all the messages of that folder that gain or lose the tag.
		let updates = new Map();
		let update = (hdr, tag, add) => {
			let key = `${hdr.folder.URI} ${tag} ${add}`;
			if (!updates.has(key)) {
				updates.set(key, { folder: hdr.folder, tag, add, hdrs: [] });
			}
			updates.get(key).hdrs.push(hdr);
		};
		let updated = 0;
		for (let hdr of messages) {
			let added = [...wanted.get(hdr)].filter(tag => !current.get(hdr).includes(tag));
			let removed = current.get(hdr).filter(tag => !wanted.get(hdr).has(tag));
			added.forEach(tag => update(hdr, tag, true));
			removed.forEach(tag => update(hdr, tag, false));
			if (added.length || removed.length) {
				updated++;
			}
		}
		writing = true;
		try {
			for (let { folder, tag, add, hdrs } of updates.values()) {
				if (add) {
					folder.addKeywordsToMessages(hdrs, tag);
				} else {
					folder.removeKeywordsFromMessages(hdrs, tag);
				}
			}
		} finally {
			writing = false;
		}
		console.log(`AutoTagger: ${changes.length} change(s), ${updated} message(s) updated in ${Date.now() - start} ms.`);
	} catch (e) {
		console.error("AutoTagger: sync failed.", e);
	}
}

// Runs the Local Folders filters marked "Manually Run" on the messages of the scope, like
// Thunderbird's Run Filters on Folder command, a few messages at a time. The tags they add are then
// spread to their threads by the sync. Resolves to the number of messages filtered.
async function runFilters() {
	let msgWindow = Services.wm.getMostRecentWindow("mail:3pane")?.msgWindow;
	let count = 0;
	filtering = true;
	try {
		for (let folder of scopeFolders()) {
			let hdrs = scopeMessages(folder);
			for (let i = 0; i < hdrs.length; i += CHUNK) {
				await applyFilters(folder, hdrs.slice(i, i + CHUNK), msgWindow);
				await new Promise(resolve => setTimeout(resolve, 0)); // Lets Thunderbird handle other events.
			}
			count += hdrs.length;
		}
	} finally {
		filtering = false;
		schedule(0);
	}
	return count;
}

function applyFilters(folder, hdrs, msgWindow) {
	return new Promise(resolve => {
		MailServices.filters.applyFilters(Ci.nsMsgFilterType.Manual, hdrs, [], folder, msgWindow, {
			QueryInterface: ChromeUtils.generateQI(["nsIMsgOperationListener"]),
			onStopOperation: resolve
		});
	});
}
