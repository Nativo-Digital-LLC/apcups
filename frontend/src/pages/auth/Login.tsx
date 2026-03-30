import { useState } from 'react';
import { Button, Input, Form, Typography, notification } from 'antd';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const { Title, Text } = Typography;

export function Login() {
  const [loading, setLoading] = useState(false);
  const { login, isSetup, token } = useAuth();
  const navigate = useNavigate();

  if (isSetup === false) {
    return <Navigate to="/setup" replace />;
  }

  if (token) {
    return <Navigate to="/" replace />;
  }

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión');

      login(data.token, data.user);
      navigate('/dashboard');
    } catch (err: any) {
      notification.error({
        message: 'Acceso Denegado',
        description: err.message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-industrial-gradient text-on-background p-4">
      <div className="max-w-md w-full bg-surface p-8 rounded-2xl border border-white/5 shadow-2xl">
        <div className="text-center mb-8">
          <img src="/logo.svg" alt="Mira" className="h-12 mx-auto mb-4" />
          <Title level={2} className="!text-on-surface !mb-2">Iniciar Sesión</Title>
          <Text className="text-on-surface-variant">Accede al panel de control de Mira</Text>
        </div>

        <Form layout="vertical" onFinish={onFinish} size="large">
          <Form.Item
            name="email"
            rules={[
              { required: true, message: 'Por favor ingresa tu correo' },
              { type: 'email', message: 'Ingresa un correo válido' }
            ]}
          >
            <Input prefix={<MailOutlined className="text-secondary" />} placeholder="Correo electrónico" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: 'Por favor ingresa tu contraseña' }]}
          >
            <Input.Password prefix={<LockOutlined className="text-secondary" />} placeholder="Contraseña" />
          </Form.Item>

          <div className="flex justify-end mb-6">
            <Link to="/forgot-password" className="text-primary hover:text-primary-focus transition-colors">
              ¿Olvidaste tu contraseña?
            </Link>
          </div>

          <Button type="primary" htmlType="submit" block loading={loading} className="!h-12 !bg-primary !text-on-primary font-medium">
            Entrar
          </Button>
        </Form>
      </div>
    </div>
  );
}
