# Home Assistant quirks

What the page does to talk to Home Assistant over one websocket, and the surprises behind it. The functions named here
are in `page/` (the protocol in `common.js`) and covered by `test/`.

## Connection

- **One websocket, one token.** `auth`, then `subscribe_entities` for the weather, climate, light, to-do,
  EV, speaker and recipe entities in the config plus `sun.sun`. Calendars
  are polled with `calendar.get_events` every 5 minutes, the forecast with `weather.get_forecasts` every 30 minutes.
- **`subscribe_entities` is compressed** (`applyEntityDiff`): `a` holds full entities, `c` changes per entity (`+` sets
  the state and adds or replaces attributes, `-` lists removed attributes), `r` removed entity ids. State is `s`,
  attributes are `a`.
- **Keep-alive.** A `ping` every 30 s; a ping still unanswered at the next one means a dead socket, so it
  reconnects. Each connection starts a fresh keep-alive record, so an unanswered ping on an old socket cannot close a new
  one.
- **Reconnect** with backoff up to 60 s. After 2 minutes without data the page shows "No connection for N min"
  next to the last known values.
- **Service calls** use `call_service`. Most send the entity in `target`; SpotifyPlus needs it in `service_data`
  instead (see [spotifyplus.md](spotifyplus.md)).

## Dates and times

- **All-day events come as `YYYY-MM-DD`.** `new Date("2026-10-19")` reads that as UTC midnight, which is the previous
  evening west of Greenwich. `parseDate` builds a local date instead.
- **Send local time with its offset.** Due times and calendar ranges go out as `2026-10-19T09:00:00+02:00`
  (`localIso`), so Home Assistant reads the same instant whatever its own time zone.
- **Tests run with `TZ=Europe/Amsterdam`** so daylight-saving changes are covered.

## Integrations

- **Weather** (`weather.*`): any entity that supports `weather.get_forecasts`. The Forecast tiles read feels like,
  wind, gusts, humidity and pressure attributes when the integration provides them; the rain chance is today's
  `precipitation_probability` from the forecast.
- **Bins** (`waste`): a calendar of collections. The `Mijnafvalwijzer:` prefix of the Dutch afvalwijzer integration is
  removed, and chips take the Dutch bin colours: GFT green, plastic/PMD orange, paper blue, anything else grey. On
  collection day the whole chip fills with that colour, in equal stripes when different bins go out together.
- **To-do** (`todo.*`): a Local To-do list keeps a due date and time. Google Tasks keeps only the date, so a reminder
  time is lost. The push itself comes from `homeassistant/todo-reminders.yaml`.
- **EV**: built around a Zaptec charger and Nord Pool prices, but any entities of the same kinds work. Nord Pool now
  reports 15-minute prices; `hourlyPrices` averages each hour so the bar chart keeps 24 bars, and the hours at or below
  your cap are counted from those averages.
- **Recipes** (Garfinho): `garfinho.search` results, favourites from a sensor. Photos arrive as 1350 px squares; for imgix
  URLs the page asks for a card-sized crop (`thumbUrl`) so the frame does not decode full-size images.
- **Day and night**: switched at sunrise and sunset from `sun.sun`, or 07:00 to 19:00 on the frame's clock when that
  entity is missing.
