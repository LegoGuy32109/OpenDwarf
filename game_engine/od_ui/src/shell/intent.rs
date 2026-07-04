#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SettingChange {
    UiScale(u8),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ShellIntent {
    Open,
    Back,
    OpenSettings,
    ChangeSetting(SettingChange),
    LeaveGame,
}
