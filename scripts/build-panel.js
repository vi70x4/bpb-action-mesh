#!/usr/bin/env node
/**
 * BPB Action Panel - Panel Asset Builder
 *
 * This script inlines the CSS and JS into the HTML for distribution
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ASSETS_DIR = join(__dirname, '..', 'src', 'assets', 'panel');
const DIST_DIR = join(__dirname, '..', 'dist', 'assets', 'panel');

console.log('🏗️ Building BPB Action Panel assets...');

// Create dist directory for the panel assets
mkdirSync(DIST_DIR, { recursive: true });

// Read all panel assets
const html = readFileSync(join(ASSETS_DIR, 'index.html'), 'utf8');
const css = readFileSync(join(ASSETS_DIR, 'style.css'), 'utf8');
const js = readFileSync(join(ASSETS_DIR, 'script.js'), 'utf8');

// Create single HTML file with inline CSS and JS for standalone distribution
const inlinedHtml = html
    .replace('<link rel="stylesheet" href="style.css">', `<style>${css}</style>`)
    .replace('<script src="script.js"></script>', `<script>${js}</script>`);

// Write the built files
writeFileSync(join(DIST_DIR, 'index.html'), html);
writeFileSync(join(DIST_DIR, 'style.css'), css);
writeFileSync(join(DIST_DIR, 'script.js'), js);
writeFileSync(join(DIST_DIR, 'panel.html'), inlinedHtml);

console.log('✅ Panel assets built successfully!');
console.log(`📦 Built files in: ${DIST_DIR}`);
