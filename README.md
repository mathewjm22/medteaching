# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## Environment Variables

This application uses the Google Drive API and YouTube API to fetch content. You must provide the following environment variables.

Create a `.env` file in the root directory:

```env
VITE_GOOGLE_API_KEY=your_google_api_key_here
VITE_GOOGLE_DRIVE_ROOT_ID=1X8YH60SKS9aVmq7qHjDkSCrcW-sdq1Je
VITE_GOOGLE_CLIENT_ID=your_google_client_id_here
```

`VITE_GOOGLE_API_KEY` is required for querying the Drive folders/files and YouTube details.
`VITE_GOOGLE_DRIVE_ROOT_ID` is the ID of the parent folder in Google Drive.


## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
