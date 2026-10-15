# Run Local Inbox Filters

This minimal Thunderbird add-on adds a toolbar button labelled **Auto-tag** and the shortcut **Ctrl+Shift+F** (**⌘⇧F** on macOS). Both do the same thing, whatever folder is displayed.

Auto-tag works on all received and sent mail: the **Inbox** and **Sent** folders of every account (Local Folders and the IMAP accounts). It does two steps:

1. **Apply the filters.** It runs the Local Folders filters that are enabled and marked "Manually Run" on those folders, like Thunderbird's **Run Filters on Folder** command.
2. **Tag whole threads.** When step 1 has finished, it looks for messages of the same thread and gives each message every tag found in its thread. Messages are in the same thread when they refer to each other through `Message-ID`, `References` or `In-Reply-To`, even when they are in different folders or accounts. So a tag that a filter put on a received message also goes on your reply in Sent and on the other replies, and the other way round.

Only tags spread through a thread: other filter actions, such as Delete, apply only to the messages the filter matches. Tags are never removed. Archives, Trash, Junk, Drafts and all other folders are left alone.

The filters of the IMAP accounts are not run by Auto-tag; they keep working as usual when mail arrives or is sent.

While Auto-tag is running, its button is greyed out. With large folders, such as Gmail's Sent Mail, a run can take a while.

## Install

1. Open `Tools` → `Add-ons and Themes`.
2. Open the gear menu and choose `Install Add-on From File…`.
3. Select `xpi/run-local-inbox-filters.xpi`.
4. Restart Thunderbird if requested.
5. Use `Customise…` on the main toolbar to place the button where you want it.

The shortcut can be changed in `Add-ons and Themes` → the gear menu → `Manage Extension Shortcuts`.

The add-on uses a Thunderbird Experiment because the ordinary WebExtension APIs do not expose filters or message threads. Thunderbird will therefore request full, unrestricted access to Thunderbird and your computer; that permission is required for the button and shortcut to work.

The package targets Thunderbird 153 ESR and should also work on Thunderbird 128 or newer. An unsigned personal add-on may require Thunderbird's development/testing installation route or signing before installation.

## Build

Run `bash createXPI.sh` from this folder. It writes `xpi/run-local-inbox-filters.xpi`. Earlier versions are kept as `xpi/run-local-inbox-filters-<version>.xpi`.
