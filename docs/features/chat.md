# Chat

`T` opens chat, `/` opens a command, and Escape opens the menu. The on-screen A
button opens chat with an in-game keyboard drawn at the bottom of the safe area,
so the system keyboard never opens on a phone (see
[controls and UI](controls-and-ui.md)). It holds 120 characters. A physical
keyboard types through `keydown`: letters, Backspace, Enter sends, and Escape
closes. Paste and dictation are not supported. Use `/nick Josh Hale` to set a
name. Names are unique within a world. `/master` and `/entity` switch the view
(see [sight](sight.md)).

Chat has its own recipient-specific feed: each joining tab receives chat by
distance from its character. Message text reaches a player within five
horizontal blocks and four levels; from five through twelve horizontal blocks
the feed carries only a `:0` talking indicator, and there is no bubble beyond
that range. Typing shows `...` only within five blocks. Speech passes through
walls and sight boundaries, so bubbles can be heard outside sight without
exposing the speaker's sprite or name.

The hearing log keeps each message text it receives once, so unheard messages
never enter it. The world host adds join, leave, and name change system lines to
its own log and sends them to guests as `system` packets on the reliable
channel. Chat uses the reliable `world` channel with snapshots and player input
(see [networking](networking.md)).
