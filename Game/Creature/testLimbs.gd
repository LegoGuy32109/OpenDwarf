extends Node

func _ready() -> void:
	print("\n==Starting Limb Test==\n")
	var head = Limb.new("Head")
	var eye = Limb.new("Right Eye")
	head.connectLimb(eye)

