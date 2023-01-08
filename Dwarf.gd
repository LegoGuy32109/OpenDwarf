extends Node2D
class_name Dwarf

var coordinates : Vector2i = Vector2i()
@onready var sprites : AnimatedSprite2D = $AnimatedSprite2D


func _on_dwarf_mouse_entered():
	print(coordinates)
