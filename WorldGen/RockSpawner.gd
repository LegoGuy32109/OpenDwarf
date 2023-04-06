extends Node
class_name RockSpawner

const DIRECTIONS = [Vector2i.RIGHT, Vector2i.UP, Vector2i.LEFT, Vector2i.DOWN]
var position: Vector2i = Vector2i.ZERO
var direction: Vector2i = Vector2i.RIGHT
var borders = Rect2()
var stepHistory: Array[Vector2i] = []
var stepsSinceTurn = 0

var rnd : RandomNumberGenerator

func _init(startingPosition, newBorders, seed : String):
	rnd = RandomNumberGenerator.new()
	rnd.seed = hash(seed)
	assert(newBorders.has_point(startingPosition))
	position = startingPosition
	stepHistory.append(position)
	borders = newBorders
	
func walk(steps):
	for stepNumber in steps:
		if rnd.randf() <= 0.25 or stepsSinceTurn >= 3:
			changeDirection()
			
		if step():
			stepHistory.append(position)
		else:
			changeDirection()
	return stepHistory
	
func step():
	var targetPosition = position + direction
	if borders.has_point(targetPosition):
		stepsSinceTurn += 1
		position = targetPosition
		return true
	return false
	
func changeDirection():
	stepsSinceTurn = 0
	var directions = DIRECTIONS.duplicate()
	var order = []
	while directions.size() > 0:
		var index : int = rnd.randi_range(0, directions.size()-1)
		order.append(directions.pop_at(index))

	direction = order.pop_front()
	while not borders.has_point(position + direction):
		direction = order.pop_front()
