# Room Heating - Claude Instructions

## Version History Updates

The scripts carry only their current version in the header (`Version: X.Y.Z`) and a
`Version history: CHANGELOG.md` pointer. The history lives in `CHANGELOG.md`, one section
per script, newest first. When modifying a script:

1. **Bump the version number** in the script's header comment.
2. **Add an entry** at the top of that script's section in `CHANGELOG.md`:
   ```
   ### X.Y.Z — YYYY-MM-DD — <emoji> <Short description>

   - <Detail about what changed>
   - <Detail about why>
   - Files modified: room_heating.js (vX.Y.Z)
   ```

### Version numbering
- **Patch** (X.Y.**Z**): Bug fixes, small tweaks
- **Minor** (X.**Y**.0): New features, behavior changes
- **Major** (**X**.0.0): Breaking/architectural changes

### Emoji conventions
- Bug fix: `🐛`
- New feature: `✨`
- Improvement/optimization: `🔧`
- Temperature/climate related: `🌡️`
- Timer/delay related: `⏳`
- Notification related: `🔔`
- Silence/suppress: `🔕`
- Calendar/schedule: `📚`
- Refactor: `🔄`

## Project Context

- This is a HomeyScript that runs on a Homey smart home hub
- It controls heating for multiple rooms (Clara, Oliver, Stue, etc.)
- Configuration is in `room_heating_config.js`
- Uses `global.get()`/`global.set()` for persistent state between runs
- Sends notifications with the `create_notification` flow card action
- Check a change offline with `test/` (see `test/README.md`) before it is pasted into Homey
