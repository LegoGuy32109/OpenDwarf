extends Node2D
class_name Tile

signal actionGiven

@onready var sprite : Sprite2D = $Sprite2D
var rockImg : Texture2D = load("res://Assets/Rock.png")
var groundImg : Texture2D = load("res://Assets/Ground.png")

var coordinates : Vector2i = Vector2i()
var tooltipText : String = "Tile"

var mouseInPanel : bool = false

var movementCost : float = 0.5

#NOTE I don't know how much 900 process funcs drain, but here we are.
func _process(_delta) -> void:
	if(HUD.tileTooltipsEnabled):
		$Panel.tooltip_text = tooltipText
	else:
		$Panel.tooltip_text = ""

func _input(_event):
	if Input.is_action_just_pressed("click") and mouseInPanel:
		actionGiven.emit(coordinates)

func _ready():
	sprite.texture = rockImg
	tooltipText = "Rock"
	setName(tooltipText)
	
func setToGround():
	sprite.texture = groundImg
	tooltipText = "Ground"
	setName(tooltipText)


func setName(text : String):
	name = text + " " + name.split(" ")[1]


func _on_panel_mouse_entered():
	mouseInPanel = true


func _on_panel_mouse_exited():
	mouseInPanel = false
