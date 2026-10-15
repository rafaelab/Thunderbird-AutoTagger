# AutoTagger

This minimal Thunderbird add-on keeps the tags of a conversation the same on all its messages. It only works on **Local Folders**: the **Inbox**, and the messages of the last 180 days in **Sent**. All other folders and accounts are left alone.

Messages are in the same thread when they refer to each other through `Message-ID`, `References` or `In-Reply-To`, also across Inbox and Sent. So a tag on a received message also goes on your reply in Sent, and the other way round.

## Automatic

- **Tag a message:** the tag is added to every message of its thread.
- **Remove a tag from a message:** it is removed from every message of its thread.
- **New message** (received in the Inbox, or your copy saved to Sent): it receives the tags already on its thread.

This happens about a second after the change. If the Inbox or Sent is busy at that moment (archiving, compacting, moving messages), AutoTagger waits until it is free. Tags set while Thunderbird was closed or the add-on was disabled are not spread. Threads of more than 100 messages are skipped, since they usually come from broken `References` headers.

## Button

The toolbar button **Auto-tag** and the shortcut **Ctrl+Shift+F** (**⌘⇧F** on macOS) run the Local Folders filters that are enabled and marked "Manually Run" on the same messages: the Inbox and the last 180 days of Sent. The tags the filters add are then spread through their threads as above.

While the filters run, the button is greyed out. Avoid archiving until it is enabled again: while a filter moves messages, Thunderbird locks the folders involved and can refuse to archive from them.

## Log

Each sync writes one line to the Error Console (`Tools` → `Developer Tools` → `Error Console`), starting with `AutoTagger:`, with the number of messages updated and the time it took.

## Install

1. If **Run Local Inbox Filters** is installed, remove it: AutoTagger replaces it.
2. Open `Tools` → `Add-ons and Themes`.
3. Open the gear menu and choose `Install Add-on From File…`.
4. Select `xpi/autotagger.xpi`.
5. Restart Thunderbird if requested.
6. Use `Customise…` on the main toolbar to place the button where you want it.

The shortcut can be changed in `Add-ons and Themes` → the gear menu → `Manage Extension Shortcuts`.

The add-on uses a Thunderbird Experiment because the ordinary WebExtension APIs do not expose filters or message threads. Thunderbird will therefore request full, unrestricted access to Thunderbird and your computer.

It requires Thunderbird 153 or newer. An unsigned personal add-on may require Thunderbird's development/testing installation route or signing before installation.

## Build

Run `bash createXPI.sh`. It writes `xpi/autotagger.xpi`.
