extends CanvasLayer

var tileTooltipsEnabled : bool = false
var idleMoveEnabled : bool = true

func _on_tooltips_check_toggled(button_pressed):
	tileTooltipsEnabled = button_pressed

func _on_idle_move_check_toggled(button_pressed):
	idleMoveEnabled = button_pressed
