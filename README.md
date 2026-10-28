# OCaml Arena

1v1 races on the 46 CIS 1200 practice problems (PE8). Two players get the same problem and code against the clock while everyone else in the room watches both editors live, side by side. The first player whose code passes every test wins.

It's a static site, built for Vercel:

- **Rooms** use Supabase Realtime (broadcast + presence), since Vercel can't hold WebSocket connections itself. No database tables are needed, only a free Supabase project.
- **Grading** happens in the browser. A WebAssembly/JS build of the real OCaml toplevel (`@live-codes/ocaml`) runs each submission in a Web Worker.
- **Fairness:** there's no server, so the room's host (the earliest member still present) grades every submission in their own browser and announces results. Players never report their own scores. If the host leaves, the next member takes over.

## Deploy to Vercel

1. **Create a Supabase project** (free tier is fine) at supabase.com. Then go to Project Settings → API and copy the **Project URL** and the **anon / publishable key**. You don't need to create any tables.
2. **Push this folder to a GitHub repo and import it in Vercel.** `vercel.json` already sets the build command (`npm run build`) and the output directory (`public`).
3. **In Vercel → Settings → Environment Variables, add:**
   - `SUPABASE_URL`: the Project URL
   - `SUPABASE_ANON_KEY`: the anon key (it's meant to be public; the Supabase integration's `NEXT_PUBLIC_…` names also work)
   - optional: `ARENA_STRESS_N` (size of the "large input" tail-recursion tests, default 20000) and `ARENA_GRADE_TIMEOUT` (seconds before a run is cut off, default 15)
4. **Deploy.** Open the site, enter a name, create a room, and send the invite link.

If rooms won't connect, check your Supabase project's Realtime settings. Projects can be set to allow only private channels, and this app uses public ones.

**Without Supabase variables, the site runs in local mode.** Rooms then only connect tabs in the same browser, which is handy for trying it out. You can also force local mode with `?local` in the URL.

The problem statements and starter code come from your course's practice exam. Consider turning on Vercel's deployment protection, or otherwise keeping the link within your class.

## How a race works

1. Everyone takes a weigh-in photo (webcam or upload) and joins the room. Photos are sent over the room channel and are never stored on a server. Two people take the red and blue corners, or the host hits **Random matchup** to pick two people from the room. Everyone else watches from ringside.
2. The host rings the bell. By default the problem climbs a difficulty ladder (`public/js/zones.js`): round 1 is a random Zone 1 warm-up, round 2 comes from Zone 2, and so on up to Zone 4, without repeating a problem. The host can also pick a specific zone or problem. After a 3-second countdown, both editors unlock with the starter file.
3. Players edit the whole file, just like on PrairieLearn, and press **Run tests** (Ctrl/⌘ + Enter) as often as they like.
4. Each run is checked against:
   - the tests already in the file
   - extra hidden tests built from the examples in the problem statement
   - for the "must be tail recursive" problems, a large-input test
5. Spectators see both editors live, plus each player's pass count, test list, and compile errors. Players see only their opponent's progress until the race ends.
6. The first submission that passes everything wins, and everyone sees the loser's photo get knocked out.

**Free-for-all mode.** The host can switch the room from **1v1 duel** to **Free-for-all**. Then everyone in the room at the bell races the same problem. Each player sees only their own editor (code isn't streamed in this mode) plus live standings for the whole field. The round ends once the podium is decided (the top three have passed every test, or everyone but one in a field of three or fewer), or when the host ends it. Finishers rank by time and everyone else by tests passed, then an animated podium shows the top three. The host grades every submission in turn, so a large room makes grading queue up.

## Run it on your computer

```bash
npm install
npm run dev        # http://localhost:5173 (add ?local to test with several tabs)
```

To use real Supabase rooms locally, copy `.env.example` to `.env` and fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY`. The build reads `.env.local` and `.env`, and variables already set in your shell take priority.

## Practice the problems offline

`problems/` holds each question as its own folder. Each folder has the starter file, `PROBLEM.md`, the same extra tests, and small stand-ins for the course modules (`Assert`, `Helices`, the queue and set interfaces). With OCaml installed:

```bash
./problems/q46_reverse/run.sh
```

This compiles the folder and runs its tests with a small stack (`OCAMLRUNPARAM=l=2000`), so a non-tail-recursive answer fails the large-input test the same way the real grader would.

## Layout

- `public/`: the site (`index.html`, `css/`, `js/`). The build adds the OCaml runtime, CodeMirror, the Supabase client, `problems.json`, and `config.js`.
- `public/js/room.js`: room protocol (host election, slots, races, grading, winner).
- `public/js/program.js`: turns a player's file into one runnable program with the hidden tests.
- `public/js/grader.js`: runs programs in a fresh OCaml worker per submission, with a timeout.
- `public/js/transport.js`: Supabase Realtime transport and the same-browser local transport.
- `problems.json`, `problems/`: the 46 problems, generated by `tools/build.py`.
- `tools/`: the generators plus the checks used during development. The checks need a `tools/reference.py` with working solutions, which is left out so the repo doesn't ship an answer key:
  - `check_program.mjs` runs reference solutions through the real OCaml toplevel.
  - `sim_room.mjs` simulates whole rooms.

## Known limits

- **Tail-recursion tests in the browser are best effort.** The browser runtime's stack differs from native OCaml's, so a non-tail-recursive answer that the small-stack local runner rejects may still pass in the browser. Raising `ARENA_STRESS_N` makes those tests stricter, at the cost of slower grading.
- **Race times use the host's clock.** Submissions are ranked by when the host receives them.
- **The OCaml runtime is about 14 MB.** It downloads once per visitor and then stays cached.
