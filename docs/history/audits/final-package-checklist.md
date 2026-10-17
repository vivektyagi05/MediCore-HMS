# Final Package Checklist

## Included

- React frontend source.
- Express backend source.
- Backend models, routes, controllers, middleware, services, payments, realtime, AI, automation, and seed modules.
- Frontend API clients, contexts, routes, layouts, pages, and reusable components.
- Environment templates.
- Setup instructions.
- Integration, bug-fix, missing-connection, and workflow test-scenario reports.

## Excluded From ZIP Packages

- `node_modules/`
- `backend/node_modules/`
- `dist/`
- `backend/storage/`
- `.env`
- `.env.local`
- generated logs

## Required Local Commands

```bash
npm install
cd backend && npm install && cd ..
npm run seed:backend
npm run dev:backend
npm run dev:frontend
```

## Validation Commands

```bash
npm run lint
npm run build
npm run test:backend
```

## Production Configuration

- Use a managed MongoDB connection.
- Use a long random JWT secret.
- Configure Razorpay live keys and webhook secret.
- Configure SMTP for transactional email.
- Configure CORS to the production frontend origin.
- Move uploads and invoices to durable object storage before multi-instance deployment.
- Configure Redis for Socket.IO horizontal scaling.
