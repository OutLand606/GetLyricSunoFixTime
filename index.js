#!/usr/bin/env node
'use strict';

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import readline from 'readline';

const TOKEN_FILE = path.join(process.cwd(), 'token.txt');

// Tạo file token.txt rỗng nếu chưa tồn tại
if (!fs.existsSync(TOKEN_FILE)) {
    fs.writeFileSync(TOKEN_FILE, '');
    console.log('📄 Created empty token.txt');
}


// ---------------- Helper Functions ----------------

// Format time for SRT
function formatSRTTime(seconds) {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const secs = String(date.getUTCSeconds()).padStart(2, '0');
    const milliseconds = String(date.getUTCMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${secs},${milliseconds}`;
}

// Format time for LRC
function formatLRCTime(seconds) {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const secs = String(date.getUTCSeconds()).padStart(2, '0');
    const hundredths = String(Math.floor(date.getUTCMilliseconds() / 10)).padStart(2, '0');
    return `[${minutes}:${secs}.${hundredths}]`;
}

// Convert aligned words to SRT
function convertToSRT(alignedWords) {
    let srtContent = '';
    alignedWords.forEach((w, i) => {
        srtContent += `${i + 1}\n${formatSRTTime(w.start_s)} --> ${formatSRTTime(w.end_s)}\n${w.word}\n\n`;
    });
    return srtContent;
}

// Convert aligned words to LRC
function convertToLRC(alignedWords) {
    let lrcContent = '';
    alignedWords.forEach(w => {
        lrcContent += `${formatLRCTime(w.start_s)}${w.word}\n`;
    });
    return lrcContent;
}

// Fetch aligned words using axios
async function fetchAlignedWords(songId, token) {
    const apiUrl = `https://studio-api.prod.suno.com/api/gen/${songId}/aligned_lyrics/v2/`;
    try {
        const res = await axios.get(apiUrl, {
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (res.data?.aligned_words) return res.data.aligned_words;
        return null;
    } catch (err) {
        if (err.response && err.response.status === 401) {
            throw new Error('TOKEN_INVALID');
        }
        console.error(`Error fetching song ${songId}:`, err.message);
        return null;
    }
}

// Save file with timestamp
function saveFile(content, fileType, songId) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputDir = path.join(process.cwd(), 'output');

    // Tạo thư mục nếu chưa có
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const fileName = `aligned_words_${songId}_${timestamp}.${fileType}`;
    const filePath = path.join(outputDir, fileName);

    fs.writeFileSync(filePath, content);
    console.log(`✅ Saved: ${filePath}`);
}


// Readline wrapper
function ask(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => rl.question(question, ans => {
        rl.close();
        resolve(ans);
    }));
}

// Load token (from file or user input)
async function loadToken() {
    let token = null;

    if (fs.existsSync(TOKEN_FILE)) {
        const saved = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
        if (saved) {
            console.log(`🔑 Found saved token: ${saved.substring(0, 15)}...`);
            const choice = await ask('Use this token? (Y/n): ');
            if (choice.toLowerCase() === 'n') {
                token = await ask('Enter new Bearer token: ');
                fs.writeFileSync(TOKEN_FILE, token.trim());
                console.log('💾 New token saved.');
                return token.trim();
            } else {
                token = saved;
                console.log('👍 Using saved token.');
            }
        }
    }

    if (!token) {
        token = await ask('Enter Bearer token: ');
        fs.writeFileSync(TOKEN_FILE, token.trim());
        console.log('💾 Token saved for future runs.');
    }

    // Validate token
    try {
        await fetchAlignedWords('dummy-check', token);
    } catch (err) {
        if (err.message === 'TOKEN_INVALID') {
            console.log('❌ Token expired or invalid. Please enter a new one.');
            token = await ask('Enter Bearer token: ');
            fs.writeFileSync(TOKEN_FILE, token.trim());
            console.log('💾 Token saved.');
        }
    }

    return token.trim();
}

// ---------------- Main Script ----------------
async function main() {
    const songIdsInput = await ask('Enter song IDs (comma-separated): ');
    const songIds = songIdsInput.split(',').map(s => s.trim()).filter(Boolean);

    let fileType = await ask('Enter file type (lrc or srt, default lrc): ');
    fileType = (fileType.toLowerCase() === 'srt') ? 'srt' : 'lrc';

    const token = await loadToken();

    for (const songId of songIds) {
        console.log(`\nFetching aligned words for ${songId}...`);
        try {
            const words = await fetchAlignedWords(songId, token);
            if (!words) {
                console.log(`⚠️ No words for ${songId}`);
                continue;
            }
            const content = (fileType === 'srt') ? convertToSRT(words) : convertToLRC(words);
            saveFile(content, fileType, songId);
        } catch (err) {
            if (err.message === 'TOKEN_INVALID') {
                console.log('❌ Your token is invalid. Please run the program again to refresh.');
                break;
            }
        }
    }

    console.log('\n✅ All done!');
}

main();
