extends Button

@onready var seedInput : Control = self.get_parent().get_node("SeedInput")

func _ready():
	self.grab_focus()

func _on_line_edit_text_submitted(new_text : String):
	if new_text.length() > 0:
		_pressed()

func _pressed():
	var worldSeed : String = seedInput.text
	if worldSeed.length() > 0:
		HUD.SEED = worldSeed
	get_tree().change_scene_to_file("res://WorldGen/World.tscn")
