# Emoji Indicator

Emoji Indicator is a GNOME Shell extension that puts a fast, searchable emoji
picker in the top bar.

Open it from the panel icon or with a keyboard shortcut, search or browse by
category, and pick an emoji to copy and paste it into the focused app.

## Features

- Top-bar emoji picker for GNOME Shell
- Keyboard shortcut support, defaulting to `Super+Period` and `Ctrl+Period`
- Search across emoji glyphs, Unicode names, categories, subcategories, and keywords
- Category browsing for faces, people, nature, food, places, activities, objects, symbols, and flags
- Recent and favorite emoji sections
- Right-click or press `p` to favorite an emoji
- Configurable popup width, UI scale, and visible emoji count
- Optional open-at-cursor behavior for shortcut launches
- Vendored Unicode Emoji 17.0 data for offline use

## Install From Source

Clone the repository into any working directory, then run:

```bash
make install
gnome-extensions enable emoji-indicator@kaustubhismyname
```

If GNOME Shell has already loaded an older copy of the extension, log out and
back in after installing.

## Requirements

Runtime:

- GNOME Shell 46 or newer

Build and install tools:

- `make`
- `glib-compile-schemas`
- `gnome-extensions`

Optional development/package tools:

- `zip`, used by `make bundle`
- `dbus-run-session` and `gnome-shell`, used by `make nested-session`

Package names vary by distribution. On Fedora, the required tools are typically
provided by `make`, `glib2`, and `gnome-shell`. On Ubuntu/Debian, install
`make`, `libglib2.0-bin`, and `gnome-shell`; install `zip` if you want to build
a distributable bundle.

## Usage

- Click the panel icon to open the picker.
- Use `Super+Period` or `Ctrl+Period` to open or close it from the keyboard.
- Type in the search field to search all emoji.
- Click a category chip to browse that category.
- Click an emoji or press `Enter` on a focused emoji to paste it.
- Right-click an emoji, or press `p` on a focused emoji, to toggle favorite.
- Press `/` from the emoji grid to return focus to search.

Selecting an emoji closes the picker, copies the emoji to the clipboard, and
sends a paste keypress to the focused app.

## Settings

Open the extension preferences from GNOME Extensions or from the Settings row in
the picker.

Available settings include:

- Open picker at cursor
- Recent emoji limit
- Show or hide favorites and recents
- Visible emoji limit
- Popup width
- UI scale
- Keyboard shortcut bindings

## Development

Useful commands:

```bash
make all
make install
gnome-extensions disable emoji-indicator@kaustubhismyname
gnome-extensions enable emoji-indicator@kaustubhismyname
```

Package the extension with:

```bash
gnome-extensions pack --force \
  --extra-source=constants.js \
  --extra-source=keyboard.js \
  --extra-source=emojiData.js \
  --schema=schemas/org.gnome.shell.extensions.emoji-indicator.gschema.xml .
```

## Background

Emoji Indicator started as a fork of
[Clipboard Indicator](https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator).
The panel indicator, shortcut handling, and paste workflow were useful starting
points, but the extension has been rebuilt around emoji search, categories,
recents, and favorites instead of clipboard history.

## License

This project keeps the upstream license from Clipboard Indicator. See
[LICENSE.rst](./LICENSE.rst).
