const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session'); // Hinzugefügt
const bcrypt = require('bcrypt');

const app = express();
const db = new sqlite3.Database('datenbank.db');

app.use(bodyParser.urlencoded({ extended: false }));

// Session konfigurieren
app.use(session({
    secret: 'Ihr geheimer Schlüssel', // Ersetzen Sie dies durch einen sicheren Schlüssel
    resave: false,
    saveUninitialized: true
}));

// Tabelle für Benutzer erstellen, falls sie noch nicht existiert
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, password TEXT)");
});

function requireLogin(req, res, next) {
    if (!req.session.userId) {
        res.redirect('/login');
    } else {
        next();
    }
}

app.get('/', (req, res) => {
    if (req.session.userId) {
        res.redirect('/hauptseite');
    } else {
        res.redirect('/login');
    }
});

app.get('/register', (req, res) => {
    res.send(`
        <h1>Registrierung</h1>
        <form method="POST" action="/register">
            <label>Benutzername:</label><br>
            <input type="text" name="username"><br>
            <label>Passwort:</label><br>
            <input type="password" name="password"><br><br>
            <input type="submit" value="Registrieren">
        </form>
    `);
});

app.post('/register', (req, res) => {
    const { username, password } = req.body;
    const hashedPassword = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, hashedPassword], function(err) {
        // ...
    });
});

app.get('/login', (req, res) => {
    res.send(`
        <h1>Anmeldung</h1>
        <form method="POST" action="/login">
            <label>Benutzername:</label><br>
            <input type="text" name="username"><br>
            <label>Passwort:</label><br>
            <input type="password" name="password"><br><br>
            <input type="submit" value="Anmelden">
        </form>
    `);
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err) {
            return res.send('Ein Fehler ist aufgetreten.');
        }
        if (user && bcrypt.compareSync(password, user.password)) {
            req.session.userId = user.id;
            res.redirect('/hauptseite');
        } else {
            res.send('Ungültige Anmeldedaten.');
        }
    });
});

app.get('/hauptseite', requireLogin, (req, res) => {
    res.send(`
        <h1>Willkommen, Benutzer ${req.session.userId}!</h1>
        <p>Dies ist die Hauptseite.</p>
        <a href="/logout">Abmelden</a>
    `);
});

app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.send('Fehler beim Abmelden.');
        }
        res.redirect('/login');
    });
});

app.listen(3000, () => {
    console.log('Server läuft auf Port 3000');
});