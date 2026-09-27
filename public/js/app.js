// @ts-check
import { phoneDiagnostics, startApp } from "../../src/client/app.js";

void startApp().then(() => {
  if (location.pathname === "/phone-test") {
    void import("./phone-test.js").then((module) =>
      module.startPhoneTest(phoneDiagnostics)
    );
  }
});
