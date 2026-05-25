# Callu

Callu is a real-time community platform with:

- a Next.js web app
- a Node/Express-style server entrypoint for sockets and background tasks
- an Electron/Vite desktop app in `callu-desktop/`

## Requirements

- Node.js 20+
- npm 10+
- MongoDB
- Resend account for email delivery
- ImageKit account for chat uploads

## Setup

```bash
npm install
```

Create a `.env` file in the repository root with the needed values:

```bash
MONGODB_URI=
NEXT_PUBLIC_URL=
ADMIN_ID=
ADMIN_PASSWORD=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
OTP_BCC_EMAIL=
IMAGEKIT_PUBLIC_KEY=
IMAGEKIT_PRIVATE_KEY=
IMAGEKIT_URL_ENDPOINT=
GH_TOKEN=
```

`NEXT_PUBLIC_URL` should point to the deployed web app in production.

## Scripts

### Root app

- `npm run dev` - start the web app and server in development
- `npm run build` - build the Next.js app and compile `server.ts`
- `npm run start` - start the compiled server
- `npm run lint` - run ESLint
- `npm run seed` - seed the database

### Desktop app

From `callu-desktop/`:

- `npm run dev` - start the Vite app
- `npm run build` - build the web bundle and Electron TypeScript
- `npm run electron:dev` - run Vite and Electron together
- `npm run electron:build` - create a packaged desktop build

## Project structure

- `app/` - Next.js routes, API routes, and dashboard pages
- `components/` - shared React components
- `context/` - client state providers
- `lib/` - server utilities, database, and email helpers
- `models/` - MongoDB models
- `public/` - static assets
- `server.ts` - custom server bootstrap
- `callu-desktop/` - desktop application source

## Local development

1. Start MongoDB.
2. Set the environment variables above.
3. Run `npm run dev`.
4. Open `http://localhost:3000`.

## Deployment

The repository includes `render.yaml` for Render deployment. Make sure the production environment sets the same variables listed above.
