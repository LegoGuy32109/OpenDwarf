extends Node2D

@onready var sprite : Sprite2D = $Sprite2D
var rockImg : Texture2D = load("res://Assets/Rock.png")
var groundImg : Texture2D = load("res://Assets/Ground.png")

var coordinates: Vector2i = Vector2i()

func _ready():
	sprite.texture = rockImg
	
	
func setToGround():
	sprite.texture = groundImg

