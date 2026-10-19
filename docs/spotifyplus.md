# Spotify on the Music tab

The Music tab plays on Alexa (Echo) speakers in two ways:

- **Search** works with Alexa Media Player alone, no Spotify setup in Home Assistant.
- **Library shelves** (Playlists, Recent, Liked songs, Artists, Albums) need the SpotifyPlus integration. A tap on a
  tile plays it on the selected speaker through Spotify Connect.

## Search: Alexa Media Player only

Each entry in `music.speakers` is a `media_player` from [Alexa Media Player](https://github.com/alandtse/alexa_media_player)
(any media_player that accepts the same call works). Search sends:

```json
{ "type": "call_service", "domain": "media_player", "service": "play_media",
  "target": { "entity_id": "<speaker>" },
  "service_data": { "media_content_type": "music", "media_content_id": "<query> on Spotify" } }
```

Alexa reads `<query> on Spotify` the way it reads a spoken request, so Spotify must be linked as a music service in the
Alexa app. Recent searches are kept in the page's `localStorage` on the frame. With a library configured the Recent
list is hidden, because the shelves replace it.

## Library: SpotifyPlus

1. Spotify **Premium**. The Web API refuses playback control on free accounts.
2. A Spotify developer app at <https://developer.spotify.com/dashboard>. Note its Client ID and Client secret, and add
   the redirect URI that SpotifyPlus's setup guide asks for (Home Assistant's OAuth redirect).
3. Install **SpotifyPlus** from HACS (custom integration by thlucas1) and restart Home Assistant.
4. Settings, Devices & services, Add integration, SpotifyPlus. Enter the Client ID and secret when Home Assistant asks
   for Application Credentials, then log in to Spotify and allow access.
5. The integration creates a `media_player.spotifyplus_<name>` entity. Put it in the config:

```json
"music": {
  "speakers": [
    { "id": "media_player.kitchen_echo", "name": "Kitchen" },
    { "id": "media_player.office", "name": "Office", "device": "Office Echo" }
  ],
  "library": "media_player.spotifyplus_your_name"
}
```

Use a non-admin Home Assistant user's token for the frame, as everywhere else; it can still call `spotifyplus.*`.

### How a tile plays

Shelves are loaded with `media_player/browse_media` on the library entity, one content id per shelf:

| Shelf | `media_content_id` |
| --- | --- |
| Playlists | `spotify_user_playlists` |
| Recent | `spotify_user_recently_played` |
| Liked songs | `spotify_user_saved_tracks` |
| Artists | `spotify_user_followed_artists` |
| Albums | `spotify_user_saved_albums` |

Only children whose id starts with `spotify:` become tiles. A tap calls:

- a track: `spotifyplus.player_media_play_tracks` with `uris`;
- anything else (playlist, album, artist): `spotifyplus.player_media_play_context` with `context_uri`.

Both carry `device_id`, the Spotify Connect name of the selected speaker. It is the speaker's `device` from the config,
or else its Home Assistant `friendly_name`, or else its `name` in the config. Set `device` when the name in the Spotify
app's device list differs from the name in Home Assistant.

### Quirks

- **`entity_id` goes in `service_data` as a string.** The websocket `call_service` `target` always reaches the service
  as a list, and SpotifyPlus rejects that with `value should be a string at 'entity_id'`. The page sends
  `service_data: { entity_id: "media_player.spotifyplus_…", … }` and no `target`.
- **Echo speakers only show up in Spotify Connect after Spotify is linked in the Alexa app**, and an idle Echo can
  drop off the list. If a tile shows the "Playing …" toast but nothing plays, open Spotify on a phone and check the
  device list. Playing something on that Echo once ("Alexa, play Spotify") usually brings it back.
- **Speaker groups** from the Alexa app (for example "Everywhere") are separate Spotify Connect devices with their own
  name; give them a `device` if the names differ.

### Troubleshooting

| Symptom | Check |
| --- | --- |
| Shelves say "Could not load Spotify" | `music.library` names the SpotifyPlus entity; the integration is logged in (Settings, Devices & services) |
| Tile does nothing | Home Assistant logs for `spotifyplus`; the device name matches the Spotify app's device list |
| Search plays the wrong thing | It is Alexa's interpretation of the text; try the same phrase by voice |
| No Music tab | The `music` section is missing from `secrets/config.json` |
