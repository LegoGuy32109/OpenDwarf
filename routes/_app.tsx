import { type PageProps } from "fresh";
export default function App({ Component }: PageProps) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>my-project</title>
        <script src="/opendwarf-shim.js"></script>
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
}
