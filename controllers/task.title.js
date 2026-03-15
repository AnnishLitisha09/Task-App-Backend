const { TaskTitle } = require('../models');

exports.createTaskTitle = async (req, res) => {
    try {
        const { task_title, target_role } = req.body;
        if (!task_title) {
            return res.status(400).json({ message: 'Task title is required' });
        }

        // Check for existing title (including soft-deleted)
        const existing = await TaskTitle.findOne({
            where: { task_title },
            paranoid: false
        });

        if (existing) {
            if (existing.deletedAt) {
                // Restore if it was deleted
                await existing.restore();
                if (target_role) await existing.update({ target_role });
                return res.status(200).json(existing);
            }
            return res.status(400).json({ message: 'Task title already exists' });
        }

        const newTaskTitle = await TaskTitle.create({
            task_title,
            target_role: target_role || 'all'
        });
        res.status(201).json(newTaskTitle);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getAllTaskTitles = async (req, res) => {
    try {
        const userRole = req.userRole ? req.userRole.toLowerCase() : null;
        const { Op } = require('sequelize');
        const where = {};

        // Automatic Filtering by Token Role
        if (userRole === 'admin') {
            // Admin sees absolutely everything
        } else if (userRole === 'student') {
            // Students only see "student" and "all" roles
            where.target_role = { [Op.or]: ['student', 'all'] };
        } else {
            // Faculty, Staff, and others see everything except student-specific tasks
            where.target_role = { [Op.or]: ['faculty', 'staff', 'admin', 'all'] };
        }

        const titles = await TaskTitle.findAll({
            where,
            order: [['task_title', 'ASC']]
        });
        res.json(titles);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.updateTaskTitle = async (req, res) => {
    try {
        const { id } = req.params;
        const { task_title, target_role } = req.body;

        const record = await TaskTitle.findByPk(id);
        if (!record) return res.status(404).json({ message: 'Task title not found' });

        await record.update({
            task_title: task_title || record.task_title,
            target_role: target_role || record.target_role
        });

        res.json(record);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.deleteTaskTitle = async (req, res) => {
    try {
        const { id } = req.params;
        const record = await TaskTitle.findByPk(id);
        if (!record) return res.status(404).json({ message: 'Task title not found' });

        await record.destroy(); // Performs soft-delete due to paranoid: true
        res.json({ message: 'Task title deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Bulk Upload Task Titles from Excel
exports.bulkUploadTaskTitles = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Please upload an excel file' });
        }

        const XLSX = require('xlsx');
        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

        const results = {
            success: 0,
            skipped: 0,
            errors: []
        };

        for (const row of data) {
            const task_title = row.task_title || row.title || row.TaskTitle;
            const target_role = row.target_role || row.role || 'all';

            if (!task_title) {
                results.errors.push(`Row missing title: ${JSON.stringify(row)}`);
                continue;
            }

            // check if exists (including soft deleted)
            const existing = await TaskTitle.findOne({
                where: { task_title: task_title.trim() },
                paranoid: false
            });

            if (existing) {
                if (existing.deleted_at) { // Use underscored field name as per model
                    await existing.restore();
                    await existing.update({ target_role: target_role.toLowerCase().trim() });
                    results.success++;
                } else {
                    results.skipped++;
                }
            } else {
                await TaskTitle.create({
                    task_title: task_title.toString().trim(),
                    target_role: target_role.toString().toLowerCase().trim()
                });
                results.success++;
            }
        }

        const fs = require('fs');
        if (req.file.path) fs.unlinkSync(req.file.path);

        res.json({
            message: `Bulk upload completed. Success: ${results.success}, Skipped: ${results.skipped}`,
            details: results
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
