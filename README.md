# Protein Plate

A small web app for tracking daily protein intake, with a built-in list of Sri Lankan foods.
Pick a food, enter the weight (or the number of pieces), and the app works out the protein and keeps a running daily total.

Built with Node.js, Express and MongoDB Atlas. The front end is a single HTML file with no build step.

## Features

- Log meals by weight (raw or cooked) or by count (for example eggs)
- Daily total with a progress bar and an editable goal
- Starter list of 30 foods, including common Sri Lankan dishes
- Add, edit and delete foods from the app (a "Foods" table with search)
- History of earlier days (last 7 shown, "Show older" for more)
- Password login, required when the app runs online
- Works on a phone, at home over Wi-Fi or online on Vercel

## Project structure

```
protein-plate/
├── server.js          Express server and MongoDB access
├── package.json
├── .env.example       Template for your settings
├── static/
│   └── index.html     The whole front end (HTML, CSS, JavaScript)
├── page.js            Generated copy of static/index.html, used online
├── scripts/
│   └── build-page.js  Makes page.js
└── data/
    └── foods.json     Starter foods, imported into the database once
```

## Requirements

- [Node.js](https://nodejs.org) 18 or newer
- A free [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) cluster (M0)

## Run it locally

1. Install dependencies:

   ```
   npm install
   ```

2. In Atlas, create a database user (letters and numbers only in the password) and add your current IP address under **Network Access**.

3. Create a `.env` file next to `server.js` (you can copy `.env.example`):

   ```
   MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@YOUR-CLUSTER.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

   Optional settings:

   | Variable        | Purpose                                                  |
   | --------------- | -------------------------------------------------------- |
   | `MONGODB_DB`    | Database name (default `proteinplate`)                   |
   | `APP_USER`      | Login username                                           |
   | `APP_PASSWORD`  | Login password (use 12 or more characters)               |

   Never share or commit `.env`. It is listed in `.gitignore`.

4. Start the server and open `http://localhost:3000`:

   ```
   npm start
   ```

On the first start, if the database is empty, the server imports `data/foods.json` (and `data/data.json`, if you have one from an older version) once. After that, the database is the only source of data.

### Using it on your phone (same Wi-Fi)

Find the computer's local IP address (`ipconfig` on Windows, `ipconfig getifaddr en0` on macOS, `hostname -I` on Linux) and open `http://YOUR-IP:3000` on the phone. Use `http`, not `https`. Allow Node.js through the firewall if the page does not load.

## Password protection

When `APP_USER` and `APP_PASSWORD` are both set, the page and every API route ask for that username and password (HTTP Basic login). Your browser asks once and remembers it.

- Locally you can leave both empty to run without a login.
- When the app runs online (Vercel or `NODE_ENV=production`), it refuses to serve anything unless both are set.
- There is a short delay after a wrong attempt but no lockout, so use a long password.

## Deploy to Vercel

1. Push the project to a **private** GitHub repository. `.env` and `data/` are ignored by git.
2. On [Vercel](https://vercel.com), choose **Add New > Project** and import the repository. Leave the build settings as detected.
3. Add these environment variables: `MONGODB_URI`, `APP_USER`, `APP_PASSWORD`.
4. In Atlas under **Network Access**, allow `0.0.0.0/0`. Vercel's servers do not use a fixed IP address, so your database password is the main protection for the database. Make it long and random.
5. Deploy, open the address Vercel gives you, and log in.

Notes:

- Environment variable changes only apply to new deployments, so redeploy after changing one.
- Online, the page is served from `page.js`, a copy of `static/index.html`. It is rebuilt on every `npm start`. After changing `static/index.html`, run `npm run build-page` and commit `page.js` before you push.
- The page is sent through Express so it sits behind the login. This is why the front end lives in `static/` and not `public/`, which Vercel serves without the login.

## How foods work

Each food has up to three protein values, in grams:

| Field    | Meaning                                         |
| -------- | ----------------------------------------------- |
| `raw`    | Protein per 100 g, raw                          |
| `cooked` | Protein per 100 g, cooked                       |
| `piece`  | Protein per piece, for things you count (eggs)  |

Foods are in two groups, `default` (the starter list) and `custom` (your own). Both can be edited from the **Foods** button. Food names must be unique across both groups, ignoring upper and lower case.

The starter values are estimates. Home-cooked curries vary a lot, so correct any value to match your own recipes or a nutrition table.

Changing or deleting a food does not change meals you already logged, because each logged meal stores the protein amount calculated at the time.

## Data model (MongoDB)

| Collection | Document                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------- |
| `foods`    | `{ name, nameKey, group, order, raw?, cooked?, piece? }`                                  |
| `days`     | `{ _id: "YYYY-MM-DD", meals: [{ n, g, s, p }] }` (name, amount, form, protein in grams)   |
| `settings` | `{ _id: "app", goal }` and `{ _id: "imported" }` (marks that the one-time import has run) |

## API

| Method | Path         | Description                                  |
| ------ | ------------ | -------------------------------------------- |
| GET    | `/api/data`  | Returns `{ log, goal }`                      |
| PUT    | `/api/data`  | Saves `{ log, goal }`                        |
| GET    | `/api/foods` | Returns `{ default: [...], custom: [...] }`  |
| PUT    | `/api/foods` | Saves `{ default: [...], custom: [...] }`    |

Both PUT endpoints validate the input and only write what changed.

## Troubleshooting

- **"MONGODB_URI is missing"**: add the variable to `.env` (locally) or to the environment variables (Vercel), then redeploy.
- **"Could not connect to MongoDB" or an "SSL alert" error**: your IP is not allowed in Atlas. Add it under Network Access (`0.0.0.0/0` for Vercel) and wait until the entry shows Active. Also check the password in the connection string and that the cluster is not paused.
- **"Save failed" in the app**: the server is not running or cannot reach the database.
- **"Internal Server Error" on Vercel**: open Deployments, pick the latest one and open its Logs. The error line just before it names the cause.
- **The phone cannot open the page at home**: see "Using it on your phone" above.

## Known limitations

- The login is one shared username and password.
- Each save sends the whole day list. If you add meals on two devices without refreshing in between, the later save can overwrite the earlier one. Refresh before adding on a different device.
- The free Atlas tier does not necessarily include automatic backups, so check your cluster's backup settings.