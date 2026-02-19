const { TaskTitle } = require('../models');

exports.createTaskTitle = async (req, res) => {
    try {
        const { title } = req.body;
        if (!title) {
            return res.status(400).json({ message: 'Title is required' });
        }

        const taskTitle = await TaskTitle.create({ title });
        res.status(201).json(taskTitle);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getAllTaskTitles = async (req, res) => {
    try {
        const titles = await TaskTitle.findAll({
            order: [['title', 'ASC']]
        });
        res.json(titles);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.updateTaskTitle = async (req, res) => {
    try {
        const { id } = req.params;
        const { title } = req.body;

        const taskTitle = await TaskTitle.findByPk(id);
        if (!taskTitle) return res.status(404).json({ message: 'Task title not found' });

        await taskTitle.update({
            title: title || taskTitle.title
        });

        res.json(taskTitle);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.deleteTaskTitle = async (req, res) => {
    try {
        const { id } = req.params;
        const taskTitle = await TaskTitle.findByPk(id);
        if (!taskTitle) return res.status(404).json({ message: 'Task title not found' });

        await taskTitle.destroy();
        res.json({ message: 'Task title deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
