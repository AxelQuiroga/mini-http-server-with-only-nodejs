````md
# Mini HTTP Server (Node.js + TypeScript)

A minimal HTTP server built **from scratch** using only Node.js native modules and TypeScript.

The goal of this project is to understand how web servers work internally, without relying on frameworks such as Express or Fastify.

---

## Features

- Native HTTP server
- Manual routing
- Controllers and Services architecture
- Static file serving
- File streaming using Node.js Streams
- Video streaming (planned)
- HTTP Range Requests (planned)

---

## Tech Stack

- Node.js
- TypeScript
- Native HTTP module
- Node.js Streams

---

## Project Structure

```text
src/
│
├── controllers/
├── routes/
├── services/
├── utils/
├── types/
├── server.ts
└── index.ts (planned)

public/
│
├── images/
├── videos/
├── css/
├── js/
└── index.html

files/
````

---

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

The server will be available at:

```text
http://localhost:3000
```

---

## Roadmap

* [x] Create native HTTP server
* [x] Basic routing
* [x] Home controller
* [ ] Serve HTML from disk
* [ ] Serve CSS
* [ ] Serve JavaScript
* [ ] Serve images
* [ ] FileService
* [ ] Readable Streams
* [ ] Video streaming
* [ ] HTTP Range Requests
* [ ] MIME type detection
* [ ] Error pages (404 / 500)

---

## Purpose

This project is part of my backend learning journey, focusing on understanding the fundamentals of HTTP, file systems, streams, and server architecture before using higher-level frameworks.

```
```
