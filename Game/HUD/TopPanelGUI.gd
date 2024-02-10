# This is for the top panel of the game's UI
# Currently will turn alpha from 0 -> full when mouse enters area
extends Panel

@export var fadeTime : float = 0.2

func _ready():
	self.modulate = "#FFFFFF00"

func _on_mouse_entered():
#NOTE wow these tweens are soo cool!! https://www.youtube.com/watch?v=04TB9gxz-uM
	var tween = create_tween()
	tween.set_trans(Tween.TRANS_BOUNCE) # not critical
	tween.tween_property(self, "modulate", Color("#FFFFFFFF"), fadeTime)


func _on_mouse_exited():
	var tween = create_tween()
	tween.tween_property(self, "modulate", Color("#FFFFFF00"), fadeTime)


