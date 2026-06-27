UUID = emoji-indicator@kaustubhismyname
INSTALLPATH = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)/
MODULES = extension.js prefs.js constants.js keyboard.js emojiData.js metadata.json stylesheet.css LICENSE.rst README.md schemas/
UPLOAD_ZIP = $(UUID).shell-extension.zip

all: compile-settings

compile-settings:
	glib-compile-schemas --strict --targetdir=schemas/ schemas

install: all
	rm -rf $(INSTALLPATH)
	mkdir -p $(INSTALLPATH)
	cp -r --parents $(MODULES) $(INSTALLPATH)

nested-session:
	dbus-run-session -- env MUTTER_DEBUG_NUM_DUMMY_MONITORS=1 \
		MUTTER_DEBUG_DUMMY_MODE_SPECS=2048x1536 \
		MUTTER_DEBUG_DUMMY_MONITOR_SCALES=2 gnome-shell --nested --wayland

bundle: all
	rm -f $(UPLOAD_ZIP)
	gnome-extensions pack --force \
		--extra-source=constants.js \
		--extra-source=keyboard.js \
		--extra-source=emojiData.js \
		--schema=schemas/org.gnome.shell.extensions.emoji-indicator.gschema.xml .
