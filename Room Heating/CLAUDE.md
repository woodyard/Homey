# Room Heating - Claude Instructions

## Version History Updates

When modifying `room_heating.js`, always update the version history:

1. **Bump the version number** in the header comment (`Version: X.Y.Z` at ~line 33)
2. **Add a changelog entry** at the top of the "Recent Changes" list (~line 37) using this format:
   ```
   * X.Y.Z (YYYY-MM-DD) - <emoji> <Type>: <Short description>
   ```
3. **Add a detailed entry** in `CHANGELOG.txt` at the top (below the header), using this format:
   ```
   ==============================================
   Version X.Y.Z (YYYY-MM-DD)
   ==============================================
   <emoji> <Type>: <Short description>
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
- Uses `await tag()` and `await say()` for Homey notifications
