// 1. Инициализация базы данных в браузере (вместо SQLite)
const db = new Dexie("imusic_database");
db.version(1).stores({
    songs: "++id, title, artist, album_name, file_name, lyrics",
    favorites: "++id, song_id, is_external"
});

// Переменные плеера
let currentPlaylist = [];
const audio = document.getElementById('audio-element');

// --- СИНХРОНИЗАЦИЯ (Вместо sync_music_to_db) ---
async function importLocalMusic() {
    try {
        const dirHandle = await window.showDirectoryPicker();
        await scanFolder(dirHandle);
        loadSongs(); // Обновляем экран
    } catch (err) {
        console.error("Доступ отклонен или ошибка:", err);
    }
}

async function scanFolder(dirHandle, path = "") {
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'directory') {
            await scanFolder(entry, path + entry.name + "/");
        } else if (entry.name.endsWith('.mp3') || entry.name.endsWith('.m4a')) {
            const file = await entry.getFile();
            // Читаем теги (нужна библиотека jsmediatags в HTML)
            window.jsmediatags.read(file, {
                onSuccess: async (tag) => {
                    const exists = await db.songs.where("file_name").equals(entry.name).first();
                    if (!exists) {
                        await db.songs.add({
                            title: tag.tags.title || entry.name,
                            artist: tag.tags.artist || "Неизвестный исполнитель",
                            album_name: tag.tags.album || "Без альбома",
                            file_name: entry.name, // В браузере храним имя или Blob
                            file_data: file // Сохраняем сам файл
                        });
                    }
                }
            });
        }
    }
}

// --- ЗАГРУЗКА ДАННЫХ (Вместо FastAPI эндпоинтов) ---

async function loadSongs() {
    const songs = await db.songs.toArray();
    displaySongs(songs, "Все песни");
}

async function loadAlbums() {
    const songs = await db.songs.toArray();
    const albums = [...new Set(songs.map(s => s.album_name))];
    const mainView = document.getElementById('main-view');
    mainView.innerHTML = albums.map(album => `
        <div class="album-card" onclick="filterByAlbum('${album}')">
            <div class="cover-placeholder">💿</div>
            <p>${album}</p>
        </div>
    `).join('');
}

async function loadFavorites() {
    const favs = await db.favorites.toArray();
    const songIds = favs.map(f => f.song_id);
    const songs = await db.songs.where('id').anyOf(songIds).toArray();
    displaySongs(songs, "Любимые");
}

// --- ЛОГИКА ОТОБРАЖЕНИЯ ---

function displaySongs(songs, title) {
    document.getElementById('content-header').innerHTML = `<h1>${title}</h1>`;
    const mainView = document.getElementById('main-view');
    
    if (songs.length === 0) {
        mainView.innerHTML = `
            <div class="empty-state">
                <p>Тут пока пусто.</p>
                <button onclick="importLocalMusic()">Добавить папку с музыкой</button>
            </div>`;
        return;
    }

    mainView.innerHTML = songs.map(song => `
        <div class="song-row" onclick="playSong(${song.id})">
            <div class="song-info">
                <div class="song-title">${song.title}</div>
                <div class="song-artist">${song.artist} — ${song.album_name}</div>
            </div>
            <button class="fav-btn" onclick="toggleFav(event, ${song.id})">★</button>
        </div>
    `).join('');
}

// --- ПЛЕЕР ---

async function playSong(id) {
    const song = await db.songs.get(id);
    if (!song) return;

    // Создаем URL из сохраненного файла
    const blobUrl = URL.createObjectURL(song.file_data);
    audio.src = blobUrl;
    audio.play();

    document.getElementById('cur-title').innerText = song.title;
    document.getElementById('cur-artist').innerText = song.artist;
    
    // Обновляем текст песни
    document.getElementById('lyrics-title').innerText = song.title;
    document.getElementById('lyrics-artist').innerText = song.artist;
    document.getElementById('lyrics-container').innerText = song.lyrics || "Ищу текст...";
    
    if (!song.lyrics) fetchLyrics(id, song.artist, song.title);
}

// --- LYRICS (Вместо Python requests) ---

async function fetchLyrics(id, artist, title) {
    try {
        const res = await fetch(`https://api.lyrics.ovh/v1/${artist}/${title}`);
        const data = await res.json();
        const lyrics = data.lyrics || "Текст не найден";
        await db.songs.update(id, { lyrics: lyrics });
        if (document.getElementById('lyrics-title').innerText === title) {
            document.getElementById('lyrics-container').innerText = lyrics;
        }
    } catch (e) {
        document.getElementById('lyrics-container').innerText = "Ошибка загрузки текста";
    }
}

// --- ИНТЕРФЕЙСНЫЕ ФУНКЦИИ ---

function toggleLyrics() {
    document.getElementById('lyrics-overlay').classList.toggle('active');
}

async function toggleFav(event, id) {
    event.stopPropagation();
    const exists = await db.favorites.where('song_id').equals(id).first();
    if (exists) {
        await db.favorites.delete(exists.id);
    } else {
        await db.favorites.add({ song_id: id });
    }
}

// Запуск при старте
loadSongs();