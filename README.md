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
- Works on a phone over your home Wi-Fi
- Data stored in MongoDB Atlas, so the laptop and phone always see the same data

## Project structure

```
protein-plate/
├── server.js          Express server and MongoDB access
├── package.json
├── .env.example       Template for your connection string
├── public/
│   └── index.html     The whole front end (HTML, CSS, JavaScript)
└── data/
    └── foods.json     Starter foods, imported into the database once
```

## Requirements

- [Node.js](https://nodejs.org) 18 or newer
- A free [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) cluster (M0)

## Setup

1. **Install dependencies**

   ```
   npm install
   ```

2. **Create your Atlas database user and allow your IP.**
   In Atlas, create a database user (use letters and numbers only in the password) and add your current IP address under Network Access.

3. **Create a `.env` file** next to `server.js`. You can copy `.env.example`:

   ```
   MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@YOUR-CLUSTER.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

   Optional: `MONGODB_DB=proteinplate` to choose the database name (this is the default).
   Never share or commit this file. It is already listed in `.gitignore`.

4. **Start the server**

   ```
   npm start
   ```

5. Open `http://localhost:3000`.

### First start

If the database is empty, the server imports `data/foods.json` (and `data/data.json`, if you have one from an older version) once. After that, the database is the only source of data and the files in `data/` are not used.

## Using it on your phone

Your phone and computer must be on the same Wi-Fi.

1. Find the computer's local IP address: `ipconfig` on Windows, `ipconfig getifaddr en0` on macOS, `hostname -I` on Linux.
2. On the phone, open `http://YOUR-IP:3000`, for example `http://192.168.1.20:3000` (use `http`, not `https`).

If it does not load, allow Node.js through the firewall on private networks. The IP can change when the router restarts; repeat step 1 to find the new one.

## How foods work

Each food has up to three protein values, in grams:

| Field    | Meaning                                         |
| -------- | ----------------------------------------------- |
| `raw`    | Protein per 100 g, raw                          |
| `cooked` | Protein per 100 g, cooked                       |
| `piece`  | Protein per piece, for things you count (eggs)  |

Foods are in two groups, `default` (the starter list) and `custom` (your own). Both can be edited from the **Foods** button in the app. Food names must be unique across both groups, ignoring upper and lower case.

The starter values are estimates. Home-cooked curries vary a lot, so correct any value to match your own recipes or a nutrition table.

Changing or deleting a food does not change meals you already logged, because each logged meal stores the protein amount calculated at the time.

## Data model (MongoDB)

| Collection | Document                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------- |
| `foods`    | `{ name, nameKey, group, order, raw?, cooked?, piece? }`                                      |
| `days`     | `{ _id: "YYYY-MM-DD", meals: [{ n, g, s, p }] }` (name, amount, form, protein in grams)      |
| `settings` | `{ _id: "app", goal }` and `{ _id: "imported" }` (marks that the one-time import has run)    |

## API

| Method | Path         | Description                                  |
| ------ | ------------ | -------------------------------------------- |
| GET    | `/api/data`  | Returns `{ log, goal }`                      |
| PUT    | `/api/data`  | Saves `{ log, goal }`                        |
| GET    | `/api/foods` | Returns `{ default: [...], custom: [...] }`  |
| PUT    | `/api/foods` | Saves `{ default: [...], custom: [...] }`    |

Both PUT endpoints validate the input and only write what changed.

## Troubleshooting

- **"MONGODB_URI is missing"**: create the `.env` file described above.
- **"Could not connect to MongoDB"**: check the password in `.env`, make sure your current IP is allowed in Atlas under Network Access, and make sure you are online.
- **"Save failed" in the app**: the server is not running or cannot reach the database.
- **The phone cannot open the page**: see "Using it on your phone" above.

## Known limitations

- There is no login. Anyone who can reach the server can read and change your data, so keep it on your home network or add authentication before putting it online.
- Each save sends the whole day list. If you add meals on two devices without refreshing in between, the later save can overwrite the earlier one. Refresh before adding on a different device.
- The free Atlas tier does not necessarily include automatic backups, so export or copy your data now and then.

## Ideas for next steps

- Export and import a backup file
- Weekly average and charts
- Deploy online (for example on Render) with a password login