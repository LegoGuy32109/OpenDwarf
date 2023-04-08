extends CanvasLayer

var tileTooltipsEnabled : bool = false
var idleMoveEnabled : bool = true

# I'll turn this into an enum eventually
var miningModeActive : bool = false
var moveModeActive : bool = true

var displayText : String = ""
func _on_tooltips_check_toggled(button_pressed):
	tileTooltipsEnabled = button_pressed

func _on_idle_move_check_toggled(button_pressed):
	idleMoveEnabled = button_pressed

func _unhandled_key_input(event):
	if event.is_action_pressed("mining-mode"):
		miningModeActive = !miningModeActive
		moveModeActive = !moveModeActive

func _process(_delta):
	if miningModeActive:
		displayText += "Mining Mode Active\n"
	
	$ModeLabel.text = displayText
	displayText = ""
