const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const db = new sqlite3.Database('datenbank.db');

app.use(bodyParser.urlencoded({ extended: false }));

// Tabelle für Benutzer erstellen
db.serialize(() => {
    db.run("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, password TEXT)");
});

app.get('/', (req, res) => {
    res.send(`
        <h1>Anmeldung</h1>
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
    db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, password], function(err) {
        if (err) {
            return console.log(err.message);
        }
        res.send('Anmeldedaten erfolgreich gespeichert!');
    });
});

app.listen(3000, () => {
    console.log('Server läuft auf Port 3000');
});