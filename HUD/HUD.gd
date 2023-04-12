extends CanvasLayer

var tileTooltipsEnabled : bool = false
var idleMoveEnabled : bool = true

# I'll turn this into an enum eventually
var miningModeActive : bool = false
var moveModeActive : bool = true

# edited when creating a world
var SEED : String = "godot"

var displayText : String = ""

@onready var confirmationDialog = $CenterContainer/ConfirmationDialog

func exitDialog():
	if confirmationDialog.visible:
		confirmationDialog.hide()
	else:
		confirmationDialog.show()

func _on_confirmation_dialog_confirmed():
	get_tree().change_scene_to_file("res://Menus/main_menu.tscn")

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



