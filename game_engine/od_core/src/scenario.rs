//! Documented home for the shared deterministic `Scenario` / replay format.
//!
//! Increment 1 lands only this module path so native sim harness, browser
//! goldens, and future `od_world` share one place to hang types. **No**
//! world-specific or typed step vocabulary lives here yet — those land with
//! Increment 2 / the `od_world` design interview, aligned to real
//! `SessionIntent` and world commands rather than guessed ahead of the model.
//!
//! See `docs/design/game-testing-harness.md` §3 and §7.
