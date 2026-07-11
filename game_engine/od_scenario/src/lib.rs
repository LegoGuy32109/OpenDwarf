//! Intent-level Scenario authoring and native Stage A runner.
//!
//! See `docs/design/scenario.md`. Browser `runScenario` is Stage B.

#![warn(clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]

mod builder;
mod document;
mod error;
mod keymap;
mod runner;

pub use builder::ScenarioBuilder;
pub use document::{
    AssertStep, EngineAction, InputAction, SCENARIO_FORMAT_VERSION, Scenario, ScenarioStep,
    ShellAction, scenario_from_json, scenario_to_json,
};
pub use error::ScenarioRunError;
pub use keymap::{DEFAULT_KEYMAP_PROFILE, KeymapProfile, keymap_profile};
pub use runner::{ScenarioRunResult, run_scenario_native};
