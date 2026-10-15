var { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");

var LocalInboxFilters = class extends ExtensionAPI {
	getAPI(context) {
		return {
			LocalInboxFilters: {
				async run() {
					let msgWindow = Services.wm.getMostRecentWindow("mail:3pane")?.msgWindow;
					let folders = inboxAndSentFolders();
					await applyFilters(folders, msgWindow); // Step 1
					return tagThreads(folders); // Step 2
				}
			}
		};
	}
};

// All received and sent messages: the Inbox and Sent folders of every account.
// The Unified Folders are skipped: they are virtual and only show those same folders.
function inboxAndSentFolders() {
	let { Inbox, SentMail, Virtual } = Ci.nsMsgFolderFlags;
	return MailServices.accounts.allFolders.filter(folder => folder.flags & (Inbox | SentMail) && !(folder.flags & Virtual));
}

// Step 1: runs the Local Folders filters marked "Manually Run" on the folders, like Thunderbird's
// Run Filters on Folder command, and resolves when filtering has finished.
function applyFilters(folders, msgWindow) {
	let localFolders = MailServices.accounts.localFoldersServer.rootFolder;
	let filterList = localFolders.getFilterList(msgWindow);
	let manualFilters = MailServices.filters.getTempFilterList(localFolders);
	for (let i = 0; i < filterList.filterCount; i++) {
		let filter = filterList.getFilterAt(i);
		if (filter.enabled && !filter.temporary && filter.filterType & Ci.nsMsgFilterType.Manual) {
			manualFilters.insertFilterAt(manualFilters.filterCount, filter);
		}
	}
	return new Promise(resolve => {
		MailServices.filters.applyFiltersToFolders(manualFilters, folders, msgWindow, {
			QueryInterface: ChromeUtils.generateQI(["nsIMsgOperationListener"]),
			onStopOperation: resolve
		});
	});
}

// Step 2: messages that refer to each other (Message-ID, References, In-Reply-To) are in the same
// thread, even in different folders or accounts. Gives every message all the tags found in its
// thread and returns the number of messages that received tags.
function tagThreads(folders) {
	let tagKeys = new Set(MailServices.tags.getAllTags().map(tag => tag.key.toLowerCase()));
	let tagsOf = hdr => hdr.getStringProperty("keywords").toLowerCase().split(" ").filter(key => tagKeys.has(key));

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

	let messages = [];
	for (let folder of folders) {
		try {
			for (let hdr of folder.msgDatabase.enumerateMessages()) {
				messages.push(hdr);
				for (let i = 0; i < hdr.numReferences; i++) {
					let reference = hdr.getStringReference(i);
					if (reference) {
						join(reference, hdr.messageId);
					}
				}
			}
		} catch (e) {
			console.warn(`Auto-tag: skipped ${folder.URI}.`, e);
		}
	}

	let threadTags = new Map();
	for (let hdr of messages) {
		let thread = threadOf(hdr.messageId);
		if (!threadTags.has(thread)) {
			threadTags.set(thread, new Set());
		}
		for (let tag of tagsOf(hdr)) {
			threadTags.get(thread).add(tag);
		}
	}

	// One call per folder and tag, with all the messages of that folder that miss the tag.
	let updates = new Map();
	let tagged = 0;
	for (let hdr of messages) {
		let own = tagsOf(hdr);
		let missing = [...threadTags.get(threadOf(hdr.messageId))].filter(tag => !own.includes(tag));
		for (let tag of missing) {
			let key = `${hdr.folder.URI} ${tag}`;
			if (!updates.has(key)) {
				updates.set(key, { folder: hdr.folder, tag, hdrs: [] });
			}
			updates.get(key).hdrs.push(hdr);
		}
		if (missing.length) {
			tagged++;
		}
	}
	for (let { folder, tag, hdrs } of updates.values()) {
		folder.addKeywordsToMessages(hdrs, tag);
	}
	return tagged;
}
