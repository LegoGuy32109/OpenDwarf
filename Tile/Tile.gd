extends Node2D
class_name Tile

signal boundIn
signal boundOut

@onready var sprite : Sprite2D = $Sprite2D
var rockImg : Texture2D = load("res://Assets/Rock.png")
var groundImg : Texture2D = load("res://Assets/Ground.png")

var coordinates : Vector2i = Vector2i()
var tooltipText : String = "Tile"

var mouseInPanel : bool = false
var beenEdited : bool = false

var movementCost : float = 0.5
var traversable : bool = false

var percentMined : float = 0.0

#NOTE I don't know how much 900 process funcs drain, but here we are.
func _process(_delta) -> void:
	if(HUD.tileTooltipsEnabled):
		$Panel.tooltip_text = tooltipText
	else:
		$Panel.tooltip_text = ""

func _input(_event) -> void:
	if mouseInPanel:
		if not beenEdited and Input.is_action_pressed("right-click"):
			if traversable:
				setToRock()
			else:
				setToGround()
			beenEdited = true
		
		if Input.is_action_just_released("right-click"):
			beenEdited = false
		
		if Input.is_action_just_pressed("click") or Input.is_action_just_pressed("shift-click"):
			# this will emit twice when shift-clicked, handled in WorldSpawn
			print("inbound "+str(coordinates))
			boundIn.emit(self)
			
		if Input.is_action_just_released("click"):
			boundOut.emit(self)
			print("outbound "+str(coordinates))
			
		if Input.is_action_just_released("shift-click"):
			boundOut.emit(self, "force")
	else:
		beenEdited = false

func _ready() -> void:
	setToRock()
	
func mine() -> void:
	# take in entity info, for like mining proficency
	percentMined += 0.2 # randomize in some way?
	if percentMined >= 1.0:
		setToGround()
	
func setToRock() -> void:
	sprite.texture = rockImg
	tooltipText = "Rock"
	setName(tooltipText)
	traversable = false
	
func setToGround() -> void:
	sprite.texture = groundImg
	tooltipText = "Ground"
	setName(tooltipText)
	traversable = true

func setName(text : String) -> void:
	name = text + " " + name.split(" ")[1]

func _on_panel_mouse_entered() -> void:
	mouseInPanel = true

func _on_panel_mouse_exited() -> void:
	mouseInPanel = false
