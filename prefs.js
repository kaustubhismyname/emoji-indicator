import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { PrefsFields } from './constants.js';

export default class EmojiIndicatorPreferences extends ExtensionPreferences {
    fillPreferencesWindow (window) {
        const settings = this.getSettings();
        const ui = new SettingsUI(settings);

        window.set_default_size(640, 520);

        const behaviorPage = new Adw.PreferencesPage({
            title: _('Behavior'),
            icon_name: 'face-smile-symbolic',
        });
        behaviorPage.add(ui.behaviorGroup);
        behaviorPage.add(ui.sectionsGroup);
        behaviorPage.add(ui.layoutGroup);
        window.add(behaviorPage);

        const shortcutsPage = new Adw.PreferencesPage({
            title: _('Shortcuts'),
            icon_name: 'input-keyboard-symbolic',
        });
        shortcutsPage.add(ui.shortcutsGroup);
        window.add(shortcutsPage);
    }
}

class SettingsUI {
    constructor (settings) {
        this.settings = settings;

        this.behaviorGroup = new Adw.PreferencesGroup({
            title: _('Paste Behavior'),
        });
        this.sectionsGroup = new Adw.PreferencesGroup({
            title: _('Picker Sections'),
        });
        this.layoutGroup = new Adw.PreferencesGroup({
            title: _('Layout'),
        });
        this.shortcutsGroup = new Adw.PreferencesGroup({
            title: _('Shortcuts'),
        });

        this.openAtCursor = new Adw.SwitchRow({
            title: _('Open at cursor'),
            subtitle: _('Open the picker at the pointer position when using the shortcut'),
        });
        this.recentLimit = new Adw.SpinRow({
            title: _('Recent emoji limit'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 200,
                step_increment: 1,
            }),
        });
        this.visibleEmojiLimit = new Adw.SpinRow({
            title: _('Visible emoji'),
            subtitle: _('Maximum emoji buttons rendered at once'),
            adjustment: new Gtk.Adjustment({
                lower: 40,
                upper: 500,
                step_increment: 10,
                page_increment: 40,
            }),
        });
        this.popupWidth = new Adw.SpinRow({
            title: _('Popup width'),
            subtitle: _('Width of the picker in pixels'),
            adjustment: new Gtk.Adjustment({
                lower: 300,
                upper: 700,
                step_increment: 10,
                page_increment: 50,
            }),
        });
        this.uiScale = new Adw.SpinRow({
            title: _('UI scale'),
            subtitle: _('Size of emoji buttons, category buttons, and text'),
            adjustment: new Gtk.Adjustment({
                lower: 75,
                upper: 150,
                step_increment: 5,
                page_increment: 10,
            }),
        });

        this.showFavorites = new Adw.SwitchRow({
            title: _('Show favorites'),
        });
        this.showRecents = new Adw.SwitchRow({
            title: _('Show recent emoji'),
        });

        this.enableKeybindings = new Adw.SwitchRow({
            title: _('Enable shortcuts'),
        });
        const toggleShortcut = new Adw.ActionRow({
            title: _('Open emoji picker'),
        });
        toggleShortcut.add_suffix(this.#createShortcutButton(PrefsFields.BINDING_TOGGLE_PICKER));

        this.behaviorGroup.add(this.openAtCursor);
        this.behaviorGroup.add(this.recentLimit);
        this.sectionsGroup.add(this.showFavorites);
        this.sectionsGroup.add(this.showRecents);
        this.layoutGroup.add(this.visibleEmojiLimit);
        this.layoutGroup.add(this.popupWidth);
        this.layoutGroup.add(this.uiScale);
        this.shortcutsGroup.add(this.enableKeybindings);
        this.shortcutsGroup.add(toggleShortcut);

        settings.bind(PrefsFields.OPEN_AT_CURSOR, this.openAtCursor, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind(PrefsFields.RECENT_LIMIT, this.recentLimit, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind(PrefsFields.VISIBLE_EMOJI_LIMIT, this.visibleEmojiLimit, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind(PrefsFields.POPUP_WIDTH, this.popupWidth, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind(PrefsFields.UI_SCALE, this.uiScale, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind(PrefsFields.SHOW_FAVORITES, this.showFavorites, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind(PrefsFields.SHOW_RECENTS, this.showRecents, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind(PrefsFields.ENABLE_KEYBINDING, this.enableKeybindings, 'active', Gio.SettingsBindFlags.DEFAULT);
    }

    #createShortcutButton (pref) {
        const button = new Gtk.Button({
            has_frame: false,
            valign: Gtk.Align.CENTER,
        });

        const setLabelFromSettings = () => {
            const value = this.settings.get_strv(pref)[0];
            button.set_label(value || _('Disabled'));
        };

        setLabelFromSettings();

        button.connect('clicked', () => {
            if (button._editing) {
                button.set_label(button._previousLabel);
                button._editing = false;
                return;
            }

            button._editing = true;
            button._previousLabel = button.get_label();
            button.set_label(_('Enter shortcut'));

            const controller = new Gtk.EventControllerKey();
            button.add_controller(controller);
            let handlerId = 0;

            const stopEditing = () => {
                button._editing = false;
                setLabelFromSettings();
                if (handlerId)
                    controller.disconnect(handlerId);
                button.remove_controller(controller);
            };

            handlerId = controller.connect('key-pressed', (_controller, keyval, _keycode, mask) => {
                mask = mask & Gtk.accelerator_get_default_mod_mask();

                if (keyval === Gdk.KEY_Escape) {
                    button.set_label(button._previousLabel);
                    stopEditing();
                    return Gdk.EVENT_STOP;
                }

                if (keyval === Gdk.KEY_BackSpace) {
                    this.settings.set_strv(pref, []);
                    stopEditing();
                    return Gdk.EVENT_STOP;
                }

                if (!Gtk.accelerator_valid(keyval, mask))
                    return Gdk.EVENT_STOP;

                this.settings.set_strv(pref, [Gtk.accelerator_name(keyval, mask)]);
                stopEditing();
                return Gdk.EVENT_STOP;
            });
        });

        return button;
    }
}
