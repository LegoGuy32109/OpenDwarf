extends Panel


func _ready():
	self.modulate = "#FFFFFF00"
	

func _on_mouse_entered():
	self.modulate = "#FFFFFFFF"


func _on_mouse_exited():
	self.modulate = "#FFFFFF00"


